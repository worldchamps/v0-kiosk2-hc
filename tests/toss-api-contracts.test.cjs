const assert = require("node:assert/strict")
const test = require("node:test")
const { readFileSync } = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

// No actual HTTP request is possible: fetch and all module imports are allowlisted fakes.
function load(file, dependencies = {}, globals = {}) {
  const exports = {}
  const source = readFileSync(path.join(__dirname, "..", file), "utf8")
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, require(name) {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
    process: { env: { NODE_ENV: "test", TOSS_PAY_API_KEY: "offline-key" } },
    console: { info() {}, error() {} }, Date, URL, AbortSignal, ...globals,
  }, { filename: file })
  return exports
}
const next = { NextResponse: { json: (data, options) => Response.json(data, options) } }
const completed = { code: 0, mode: "TEST", payToken: "token-123", orderNo: "order-123", payStatus: "PAY_COMPLETE", payMethod: "CARD", amount: 60000 }
function harness(payload = completed, options = {}) {
  const calls = []
  const timeouts = []
  const toss = load("lib/toss-pay.ts", {}, {
    fetch: async (url, init) => {
      calls.push({ url, init })
      if (options.throw) throw new Error("offline provider unavailable")
      return options.badJson ? new Response("not JSON") : Response.json(payload, { status: options.status || 200 })
    },
    AbortSignal: { timeout(ms) { timeouts.push(ms); return new AbortController().signal } },
  })
  const deps = { "next/server": next, "@/lib/toss-pay": toss }
  const callback = load("app/api/toss-payments/callback/route.ts", deps)
  const status = load("app/api/toss-payments/status/route.ts", deps)
  const create = load("app/api/toss-payments/create/route.ts", {
    ...deps, crypto: { randomUUID: () => "11111111-1111-4111-8111-111111111111" },
    "@/lib/on-site-pricing": load("lib/on-site-pricing.ts"),
    "@/lib/kiosk-scope": { getKioskScope: () => ({ property: "property3", building: "B" }), buildingRestrictionMessage: () => "B동 제한" },
  }, { process: { env: { NODE_ENV: "production", TOSS_PAY_PUBLIC_BASE_URL: options.base || "https://offline.invalid/path" } } })
  const request = (body, pathname = "callback") => {
    const url = `http://localhost/api/toss-payments/${pathname}`
    return { url, nextUrl: new URL(url), json: async () => body }
  }
  return { toss, callback, status, create, calls, timeouts, request }
}

test("completed card verification binds token, order, amount and card method", async () => {
  for (const change of [{ payToken: "other-token" }, { orderNo: "other-order" }, { amount: 50000 },
    { payStatus: "PAY_CANCEL" }, { payMethod: "TOSS_MONEY" }]) {
    const { toss } = harness({ ...completed, ...change })
    await assert.rejects(toss.verifyCompletedCardPayment({ payToken: completed.payToken, orderNo: completed.orderNo, expectedAmount: 60000 }))
  }
  const { toss } = harness()
  assert.equal((await toss.verifyCompletedCardPayment({ payToken: completed.payToken, orderNo: completed.orderNo, expectedAmount: 60000 })).payStatus, "PAY_COMPLETE")
})

test("invalid payment identity and nonpositive/fractional totals are rejected before a provider request", async () => {
  for (const change of [{ payToken: {} }, { payToken: " " }, { payToken: "x".repeat(51) }, { orderNo: {} },
    { orderNo: " " }, { orderNo: "x".repeat(51) }, { expectedAmount: 0 }, { expectedAmount: -1 }, { expectedAmount: 0.5 }]) {
    const { toss, calls } = harness()
    await assert.rejects(toss.verifyCompletedCardPayment({ payToken: completed.payToken, orderNo: completed.orderNo, expectedAmount: 60000, ...change }))
    assert.equal(calls.length, 0, JSON.stringify(change))
  }
})

test("provider requests have a finite timeout, no cache, and private API credentials in the POST body only", async () => {
  const { toss, calls, timeouts } = harness()
  await toss.getTossPaymentStatus(completed.payToken)
  assert.deepEqual(timeouts, [15000])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, "https://pay.toss.im/api/v2/status")
  assert.equal(calls[0].init.method, "POST")
  assert.equal(calls[0].init.cache, "no-store")
  assert.equal(calls[0].init.signal instanceof AbortSignal, true)
  assert.equal(JSON.parse(calls[0].init.body).apiKey, "offline-key")
})

test("provider transport rejects HTTP errors, logical errors, invalid JSON and thrown requests", async () => {
  for (const options of [{ status: 503 }, { badJson: true }, { throw: true }]) {
    const { toss } = harness(completed, options)
    await assert.rejects(toss.getTossPaymentStatus(completed.payToken))
  }
  await assert.rejects(harness({ code: 400, msg: "test refusal" }).toss.getTossPaymentStatus(completed.payToken))
})

test("payment callback succeeds only after independent provider verification, including repeated delivery", async () => {
  const { callback, calls, request } = harness()
  const body = { status: "PAY_COMPLETE", payToken: completed.payToken, orderNo: completed.orderNo, amount: "60000" }
  for (let i = 0; i < 2; i++) {
    const response = await callback.POST(request(body))
    assert.equal(response.status, 200)
    assert.equal((await response.json()).success, true)
  }
  assert.equal(calls.length, 2)
})

test("forged callback payment fields do not override the provider's authoritative result", async () => {
  for (const change of [{ orderNo: "different" }, { amount: 1 }, { payMethod: "TOSS_MONEY" }, { payStatus: "PAY_CANCEL" }, { payToken: "different" }]) {
    const { callback, request } = harness({ ...completed, ...change })
    assert.equal((await callback.POST(request({ status: "PAY_COMPLETE", payToken: completed.payToken, orderNo: completed.orderNo, amount: 60000 }))).status, 400)
  }
})

test("callback malformed inputs cannot trigger provider lookups", async () => {
  for (const change of [{ amount: null }, { amount: "" }, { amount: false }, { amount: [] }, { amount: 0 },
    { amount: -10 }, { amount: 10.5 }, { payToken: {} }, { orderNo: {} }, { status: "PAY_CANCEL" }]) {
    const { callback, calls, request } = harness()
    const response = await callback.POST(request({ status: "PAY_COMPLETE", payToken: completed.payToken, orderNo: completed.orderNo, amount: 60000, ...change }))
    assert.equal(response.status, 400)
    assert.equal(calls.length, 0, JSON.stringify(change))
  }
})

test("status endpoint rejects a missing token and exposes only the public status projection", async () => {
  const { status, request, calls } = harness()
  assert.equal((await status.GET(request(null, "status"))).status, 400)
  assert.equal(calls.length, 0)
  const req = request(null, "status?payToken=token-123")
  const response = await status.GET(req)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { success: true, payStatus: "PAY_COMPLETE", payMethod: "CARD", orderNo: "order-123", amount: 60000 })
})

test("status endpoint rejects a mismatched provider token or provider failure", async () => {
  for (const h of [harness({ ...completed, payToken: "different" }), harness(completed, { throw: true })]) {
    assert.equal((await h.status.GET(h.request(null, "status?payToken=token-123"))).status, 502)
  }
})

test("payment creation rejects malformed products and physical building bypass before contacting provider", async () => {
  for (const body of [null, [], {}, { building: "B", roomType: {}, stayType: "overnight" },
    { building: "B", roomType: "스탠다드", stayType: "invalid" }]) {
    const { create, calls, request } = harness()
    const response = await create.POST(request(body))
    assert.equal(response.status, body?.building === "B" ? 400 : 403)
    assert.equal(calls.length, 0)
  }
  const { create, calls, request } = harness()
  assert.equal((await create.POST(request({ building: "A", roomType: "스탠다드", stayType: "overnight" }))).status, 403)
  assert.equal(calls.length, 0)
})

test("legacy online creation uses HTTPS callback origin and card-only automatic approval", async () => {
  const { create, calls, request } = harness({ code: 0, payToken: "created-token", checkoutPage: "https://offline.invalid/checkout", status: 200 })
  const response = await create.POST(request({ building: "B", roomType: "스탠다드", stayType: "shortStay" }))
  assert.equal(response.status, 200)
  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.amount, 30000)
  assert.equal(body.resultCallback, "https://offline.invalid/api/toss-payments/callback")
  assert.equal(body.retUrl, "https://offline.invalid/payments/toss/complete")
  assert.equal(body.enablePayMethods, "CARD")
  assert.equal(body.autoExecute, true)
  assert.equal(body.callbackVersion, "V2")
  const output = await response.json()
  assert.equal(output.payToken, "created-token")
  assert.equal(JSON.stringify(output).includes("offline-key"), false)
})

test("production creation refuses an HTTP callback configuration before provider side effects", async () => {
  const { create, calls, request } = harness(completed, { base: "http://offline.invalid" })
  assert.equal((await create.POST(request({ building: "B", roomType: "스탠다드", stayType: "shortStay" }))).status, 502)
  assert.equal(calls.length, 0)
})

import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import vm from "node:vm"
import ts from "typescript"
import * as crypto from "node:crypto"

const env = { PMS_BASE_URL: "https://pms.invalid/", PMS_KIOSK_KEY: "synthetic-key-".repeat(3),
  KIOSK_DEVICE_ID: "qa-kiosk", TOSS_FRONT_PAIRING_KEY: "synthetic-proof-key" }
const next = { NextResponse: { json: Response.json } }
function load(file: string, dependencies: Record<string, any> = {}, globals: Record<string, any> = {}) {
  const exports: Record<string, any> = {}
  const compiled = ts.transpileModule(readFileSync(new URL("../" + file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(compiled, { exports, require(name: string) {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
    return dependencies[name]
  }, process: { env }, URL, Headers, AbortSignal, Date, Buffer, console: { warn() {} }, ...globals })
  return exports
}
const helpers = load("lib/reservation-collection.ts")
const proofTools = load("lib/toss-front.ts", { crypto })
const cashId = "cash-10000000-0000-4000-a000-000000000001"
const cash = { requestId: cashId, reservationId: "qa-reservation", expectedCollected: 10000, amount: 30000,
  paidAt: "2026-10-20T01:00:00.000Z", payment: { method: "CASH" } }
function card(extra: Record<string, any> = {}) {
  const front = { paymentKey: "qa-approved-payment", amount: 30000, tax: 2727, supplyValue: 27273,
    paymentMethod: "CARD", tid: "qa-tid", approvalNumber: "qa-approval", timestamp: Date.parse(cash.paidAt), installment: 0, ...extra }
  return { ...cash, requestId: front.paymentKey, payment: { method: "CARD", provider: "TOSS_FRONT",
    front: { ...front, signature: crypto.createHmac("sha256", env.TOSS_FRONT_PAIRING_KEY)
      .update(proofTools.getTossFrontProofPayload(front)).digest("hex") } } }
}
const request = (body: unknown) => new Request("http://kiosk.invalid/api/reservation-collection", {
  method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
})
function server(fetcher: (...args: any[]) => any, settings: Record<string, string> = env) {
  return load("lib/pms-kiosk.ts", { "server-only": {} }, { process: { env: settings }, fetch: fetcher })
}

test("1. balance disabled settings preserve legacy behavior; configured fetch is authenticated, bounded and private", async () => {
  const good = { status: "ok", reservationId: cash.reservationId, price: 40000, collected: 10000, remaining: 30000,
    payable: true, guestName: "Do not expose", phoneNumber: "private", reason: "payable" }
  for (const settings of [{}, { ...env, KIOSK_DEVICE_ID: "" }, { ...env, PMS_KIOSK_KEY: "short" }]) {
    const pms = server(() => assert.fail("Disabled configuration called PMS"), settings)
    const route = load("app/api/reservation-balance/route.ts", { "next/server": next, "@/lib/pms-kiosk": pms })
    const response = await route.GET(new Request(`http://kiosk.invalid/?reservationId=${cash.reservationId}`))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { configured: false })
  }
  let warnings = 0
  const disabled = load("lib/pms-kiosk.ts", { "server-only": {} }, { process: { env: {} }, console: { warn() { warnings++ } } })
  disabled.pmsKioskConfig(); disabled.pmsKioskConfig(); assert.equal(warnings, 1)
  const timeouts: number[] = []
  const pms = load("lib/pms-kiosk.ts", { "server-only": {} }, {
    AbortSignal: { timeout: (ms: number) => { timeouts.push(ms); return AbortSignal.timeout(ms) } },
    fetch: async (url: string, init: RequestInit) => {
      assert.equal(url, `https://pms.invalid/api/kiosk/balance?reservationId=${cash.reservationId}`)
      assert.equal(new Headers(init.headers).get("Authorization"), `Bearer ${env.PMS_KIOSK_KEY}`)
      assert.equal(init.redirect, "error"); assert.equal(init.cache, "no-store")
      return Response.json(good)
    },
  })
  const route = load("app/api/reservation-balance/route.ts", { "next/server": next, "@/lib/pms-kiosk": pms })
  assert.deepEqual(await (await route.GET(new Request(`http://kiosk.invalid/?reservationId=${cash.reservationId}`))).json(),
    { configured: true, price: 40000, collected: 10000, remaining: 30000, payable: true, reason: "payable" })
  assert.deepEqual(timeouts, [8000])
  for (const id of ["", " ".repeat(2), "a".repeat(201)]) {
    assert.equal((await route.GET(new Request(`http://kiosk.invalid/?reservationId=${encodeURIComponent(id)}`))).status, 400)
  }
  for (const bad of ["timeout", "500", "json", null, { ...good, reservationId: "other" },
    { ...good, price: -1 }, { ...good, collected: "10000" }, { ...good, remaining: 1.5 },
    { ...good, remaining: Number.MAX_SAFE_INTEGER + 1 }, { ...good, payable: "true" }]) {
    const pms = server(async () => {
      if (bad === "timeout") throw new DOMException("Synthetic timeout", "TimeoutError")
      if (bad === "500") return Response.json(good, { status: 500 })
      if (bad === "json") return new Response("not-json")
      return Response.json(bad)
    })
    const route = load("app/api/reservation-balance/route.ts", { "next/server": next, "@/lib/pms-kiosk": pms })
    assert.equal((await route.GET(new Request(`http://kiosk.invalid/?reservationId=${cash.reservationId}`))).status, 503)
  }
})

test("2. only direct channel spellings require a balance when PMS is unavailable", () => {
  for (const channel of ["직접예약", "직접예약(카톡)", "전화예약", "현장예약(직원)", " 현장 "]) assert.equal(helpers.requiresPmsBalance(channel), true)
  for (const channel of ["전화예약 취소", "키오스크", "야놀자", ""]) assert.equal(helpers.requiresPmsBalance(channel), false)
})
test("3. cash amounts respect the installed device denomination", () => {
  assert.equal(helpers.cashCollectionAmount(37500, "oneplus"), 0)
  assert.equal(helpers.cashCollectionAmount(45000, "bac2400"), 0)
  assert.equal(helpers.cashCollectionAmount(50000, "bac2400"), 50000)
  assert.equal(helpers.cashCollectionAmount(37000, "oneplus"), 37000)
})

function collectionHarness() {
  const claims = new Map<string, any>(), posts: any[] = []
  let mode: string = "recorded", settings = { ...env }
  const pms = server(async (url: string, init: RequestInit) => {
    assert.equal(url, "https://pms.invalid/api/kiosk/collections")
    assert.equal(init.redirect, "error")
    assert.equal(new Headers(init.headers).get("Authorization"), `Bearer ${env.PMS_KIOSK_KEY}`)
    const body = JSON.parse(init.body as string)
    posts.push(body)
    if (mode === "timeout") throw new DOMException("Response lost after PMS commit", "TimeoutError")
    if (mode === "malformed") return Response.json({ status: "recorded", reservationId: "other" })
    if (mode === "500") return Response.json({ status: "recorded", reservationId: body.reservationId }, { status: 500 })
    if (mode === "uncertain") return Response.json({ status: "uncertain", reservationId: body.reservationId }, { status: 503 })
    if (mode === "error-without-id") return Response.json({ status: "stale" }, { status: 409 })
    if (mode === "non-json") return new Response("response truncated", { status: 200 })
    return Response.json({ status: mode, reservationId: body.reservationId, amount: body.amount, recordedAt: cash.paidAt },
      { status: ["conflict", "stale"].includes(mode) ? 409 : 200 })
  }, settings)
  const route = load("app/api/reservation-collection/route.ts", { "next/server": next, "@/lib/pms-kiosk": pms,
    "@/lib/toss-front": proofTools, "@/lib/reservation-collection": helpers,
    "@/lib/firebase-admin": {
      claimPayment: async (provider: string, key: string, details: any) => {
        assert.equal(provider, "toss_front")
        if (claims.has(key)) return false
        claims.set(key, { ...details, status: "claimed" }); return true
      },
      getPaymentClaim: async (_provider: string, key: string) => claims.get(key),
    } })
  return { claims, posts, settings, mode: (value: string) => { mode = value }, run: (body: unknown) => route.POST(request(body)) }
}
test("4. signed card proof, immutable local claim and identical retry prevent reused approvals", async () => {
  const h = collectionHarness(), valid = card()
  const forged = structuredClone(valid); forged.payment.front.signature = "0".repeat(64)
  for (const invalid of [forged, card({ amount: 30001 }), { ...valid, requestId: "different-key" },
    { ...valid, payment: { ...valid.payment, provider: "TOSS_PAY" } }]) {
    assert.equal((await h.run(invalid)).status, 400)
  }
  assert.equal(h.posts.length, 0); assert.equal(h.claims.size, 0)
  h.mode("timeout")
  assert.equal((await h.run(valid)).status, 503)
  assert.equal(h.claims.size, 1); assert.equal(h.posts.length, 1)
  assert.equal(h.claims.get(valid.requestId).purpose, "collection")
  h.mode("duplicate")
  const response = await h.run(valid)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: "duplicate", reservationId: cash.reservationId })
  assert.deepEqual(h.posts[0], h.posts[1])
  const before = h.posts.length
  assert.equal((await h.run({ ...valid, reservationId: "other-reservation" })).status, 409)
  assert.equal(h.posts.length, before)
  for (const changes of [{ reservationId: "other" }, { amount: 40000 }, { purpose: "booking" }]) {
    const original = h.claims.get(valid.requestId)
    h.claims.set(valid.requestId, { ...original, ...changes })
    const before = h.posts.length, conflict = await h.run(valid)
    assert.equal(conflict.status, 409); assert.equal((await conflict.json()).status, "conflict")
    assert.equal(h.posts.length, before)
    h.claims.set(valid.requestId, original)
  }
})
test("5. cash validates identity and amount, preserves PMS refusal, and uses only the server kiosk ID", async () => {
  const h = collectionHarness()
  for (const changes of [{ requestId: "not-cash" }, { requestId: "cash-invalid" }, { amount: 0 }, { amount: -1 },
    { amount: "30000" }, { amount: 1.2 }, { expectedCollected: -1 }, { expectedCollected: "10000" },
    { paidAt: "invalid-date" }, { reservationId: "" }]) {
    assert.equal((await h.run({ ...cash, ...changes })).status, 400)
  }
  assert.equal(h.posts.length, 0)
  for (const status of ["stale", "not_payable", "conflict", "recorded", "in_progress", "amount_mismatch"]) {
    h.mode(status)
    const response = await h.run({ ...cash, kioskId: "untrusted-browser-id" })
    assert.equal((await response.json()).status, status)
    assert.equal(h.posts.at(-1).kioskId, env.KIOSK_DEVICE_ID)
    assert.equal(h.posts.at(-1).method, "현금")
    assert.equal(h.posts.at(-1).paymentKey, cash.requestId)
  }
  assert.equal(h.claims.size, 0)
  h.mode("error-without-id")
  assert.deepEqual(await (await h.run(cash)).json(), { status: "stale", reservationId: cash.reservationId })
  for (const status of ["timeout", "500", "malformed", "unknown", "uncertain", "non-json"]) {
    h.mode(status); const result = await h.run(cash)
    assert.equal(result.status, 503); assert.deepEqual(await result.json(), { status: "error" })
  }
  h.settings.PMS_KIOSK_KEY = ""
  const before = h.posts.length
  assert.equal((await h.run(cash)).status, 503)
  assert.equal(h.posts.length, before)
})
test("collection client accepts success only with 2xx and matching reservation, and never throws offline", async () => {
  for (const [status, http, id, expected] of [
    ["recorded", 200, cash.reservationId, "recorded"], ["duplicate", 200, cash.reservationId, "duplicate"],
    ["recorded", 503, cash.reservationId, "error"], ["duplicate", 409, cash.reservationId, "error"],
    ["recorded", 200, "other", "error"], ["stale", 409, cash.reservationId, "stale"],
    ["unknown", 200, cash.reservationId, "error"],
  ]) {
    const client = load("lib/reservation-collection.ts", {}, { fetch: async (url: string, init: RequestInit) => {
      assert.equal(url, "/api/reservation-collection"); assert.equal(init.body, JSON.stringify(cash))
      return Response.json({ status, reservationId: id }, { status: http as number })
    } })
    assert.equal(await client.submitCollection(JSON.stringify(cash)), expected)
  }
  const client = load("lib/reservation-collection.ts", {}, { fetch: async () => { throw new Error("offline") } })
  assert.equal(await client.submitCollection(JSON.stringify(cash)), "error")
})

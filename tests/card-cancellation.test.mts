import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import vm from "node:vm"
import ts from "typescript"
import * as crypto from "node:crypto"
import * as events from "node:events"

const pairingKey = "isolated-test-cancellation-key"
function load(file: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, any> = {}, module = { exports }
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(source, { exports, module, require(name: string) {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]
  }, process: { env: { TOSS_FRONT_PAIRING_KEY: pairingKey } }, Date, URL, Buffer,
    console: { log() {}, error() {} }, setTimeout, clearTimeout })
  return module.exports
}

async function cancellationFixture() {
  const bridge = load("../electron/toss-front-bridge.js", {
    crypto, events, serialport: { SerialPort: class {} }, ws: class {},
  })
  const payment = bridge.signPayment({ paymentKey: "test-payment", amount: 11000, tax: 1000, supplyValue: 10000,
    paymentMethod: "CARD", tid: "test", approvalNumber: "APPROVAL", timestamp: Date.now(), installment: 0 })
  let requests = 0
  bridge.request = async () => { requests++; return { type: "CANCEL_SUCCESS", cancel: { ...payment, approvalNumber: "CANCEL" } } }
  const cancel = await bridge.cancelPayment(payment)
  const verifier = load("../lib/toss-front.ts", { crypto })
  return { bridge, payment, cancel, verifier, get requests() { return requests } }
}

test("real bridge signs a separate cancellation domain and real server verifies it without changing approval proofs", async () => {
  const f = await cancellationFixture()
  assert.equal(f.requests, 1)
  assert.equal(f.verifier.verifyTossFrontPaymentProof(f.payment, 11000).paymentKey, "test-payment")
  assert.equal(f.verifier.verifyTossFrontCancellationProof(f.cancel.cancelProof, f.payment).operation, "toss-front-cancel")
  assert.throws(() => f.verifier.verifyTossFrontCancellationProof(f.payment, f.payment))
  assert.throws(() => f.verifier.verifyTossFrontCancellationProof({ ...f.cancel.cancelProof, amount: 1 }, f.payment))
  assert.throws(() => f.verifier.verifyTossFrontCancellationProof({ ...f.cancel.cancelProof, cancelApprovalNumber: "FORGED" }, f.payment))
  assert.throws(() => f.verifier.verifyTossFrontCancellationProof(f.cancel.cancelProof, { ...f.payment, paymentKey: "another-payment" }))
})

test("bridge refuses to attest mismatched or non-cancellation terminal responses", async () => {
  const f = await cancellationFixture()
  for (const result of [
    { type: "PAYMENT_SUCCESS", cancel: f.payment },
    { type: "CANCEL_SUCCESS", cancel: { ...f.payment, amount: 22000 } },
    { type: "CANCEL_SUCCESS", cancel: { ...f.payment, paymentKey: "another-payment" } },
  ]) {
    f.bridge.request = async () => result
    await assert.rejects(f.bridge.cancelPayment(f.payment), /취소 응답/)
  }
})

async function routeHarness(id = "ONSITE-00000000-0000-4000-8000-000000000001") {
  const f = await cancellationFixture()
  const payment = { ...f.payment, reservationId: id, roomCode: "B121", status: "claimed", cancelApprovalNumber: "" }
  let writes = 0, failWrite = false, bookingState: string | undefined
  const route = load("../app/api/admin/payment-cancel/route.ts", {
    "next/server": { NextResponse: Response },
    "@/lib/firebase-admin": {
      findTossFrontPaymentClaim: async (value: string) => value === id ? payment : null,
      markTossFrontPaymentCanceled: async (_id: string, approval: string) => {
        writes++; if (failWrite) throw new Error("offline")
        payment.status = "canceled"; payment.cancelApprovalNumber = approval; return true
      },
    },
    "@/lib/kiosk-scope": { getKioskScope: () => ({ property: "property3", building: "B" }),
      isRoomInBuilding: (value: string) => /^B\d{3}$/.test(value) },
    "@/lib/property-utils": { getPropertyFromRoomNumber: (value: string) => /^[AB]\d{3}$/.test(value) ? "property3" : "property1" },
    "@/lib/toss-front": f.verifier,
    "@/lib/on-site-bookings": { bookingHash: (value: string) => crypto.createHash("sha256").update(value).digest("hex"),
      readOnSiteBooking: async () => bookingState ? { state: bookingState } : null },
  })
  return { ...f, payment, id, get writes() { return writes }, setFailWrite(value: boolean) { failWrite = value },
    setBookingState(value: string) { bookingState = value },
    get: (value = id) => route.GET(new Request("http://test.local/api/admin/payment-cancel?reservationId=" + value)),
    patch: (body: any = { reservationId: id, cancelProof: f.cancel.cancelProof }) =>
      route.PATCH(new Request("http://test.local/api/admin/payment-cancel", { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) })),
  }
}

test("new UUID and legacy numeric reservation IDs are supported, with kiosk building enforced", async () => {
  for (const id of ["ONSITE-123456", "ONSITE-00000000-0000-4000-8000-000000000001"]) {
    const h = await routeHarness(id)
    assert.equal((await h.get()).status, 200)
    h.payment.roomCode = "A121"
    assert.equal((await h.get()).status, 403)
    assert.equal((await h.patch()).status, 403)
    assert.equal(h.writes, 0)
  }
})

test("untrusted cancellation marker and malformed inputs do not mutate payment state", async () => {
  const h = await routeHarness()
  for (const body of [
    "{broken", null, { reservationId: {} }, { reservationId: "ONSITE-invalid" },
    { reservationId: h.id, cancelApprovalNumber: "FAKE" },
    { reservationId: h.id, cancelProof: h.payment },
  ]) {
    assert.equal((await h.patch(body)).status, 400)
  }
  assert.equal(h.writes, 0)
})

test("genuine cancellation recording is idempotent, and DB errors are not reported as success", async () => {
  const h = await routeHarness()
  h.setFailWrite(true)
  assert.equal((await h.patch()).status, 503)
  assert.equal(h.payment.status, "claimed")
  h.setFailWrite(false)
  assert.equal((await h.patch()).status, 200)
  const again = await h.patch()
  assert.equal(again.status, 200)
  assert.equal((await again.json()).alreadyRecorded, true)
  assert.equal(h.writes, 2)
})

test("pending booking cannot start admin cancellation; already performed cancellation proof can still be recorded", async () => {
  for (const state of ["preparing", "saving", "saved", "committing"]) {
    const h = await routeHarness(); h.setBookingState(state)
    assert.equal((await h.get()).status, 409, state)
    assert.equal(h.writes, 0)
    assert.equal((await h.patch()).status, 200)
    assert.equal(h.payment.status, "canceled")
  }
  const h = await routeHarness(); h.setBookingState("complete")
  assert.equal((await h.get()).status, 200)
})

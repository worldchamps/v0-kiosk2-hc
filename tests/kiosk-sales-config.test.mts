import assert from "node:assert/strict"
import test from "node:test"
import { defaultKioskSalesPolicy, isKioskSalesWindowOpen, normalizeKioskSalesPolicy, hasPositiveRate } from "../lib/kiosk-sales-config.ts"

test("PMS controls new on-site checkout, short-stay cutoff and duration", () => {
  const policy = normalizeKioskSalesPolicy("property4", {
    overnightCheckoutTime: "12:30",
    shortStayDurationMinutes: 240,
    shortStayTimeRestricted: true,
    shortStaySaleEndTime: "20:30",
  })
  assert.equal(policy.overnightCheckoutTime, "12:30")
  assert.equal(policy.shortStayDurationMinutes, 240)
  assert.equal(isKioskSalesWindowOpen(policy, "shortStay", new Date("2026-09-05T11:29:00Z")), true)
  assert.equal(isKioskSalesWindowOpen(policy, "shortStay", new Date("2026-09-05T11:30:00Z")), false)
  assert.equal(normalizeKioskSalesPolicy("property4", {}).overnightCheckoutTime, "11:00")
  assert.equal(normalizeKioskSalesPolicy("property4", { overnightCheckoutTime: "25:00" }).overnightCheckoutTime, "11:00")
  assert.equal(hasPositiveRate({ card: 0, cash: 0 }), false)
  assert.equal(hasPositiveRate({ card: 10000, cash: 0 }), true)
  assert.equal(hasPositiveRate({ card: 0, cash: 10000 }), true)
})

test("preserves the legacy 21:00 short-stay cutoff until PMS saves a config", () => {
  const policy = defaultKioskSalesPolicy("property3")
  assert.equal(isKioskSalesWindowOpen(policy, "shortStay", new Date("2026-09-04T11:59:00Z")), true)
  assert.equal(isKioskSalesWindowOpen(policy, "shortStay", new Date("2026-09-04T12:00:00Z")), false)
  assert.equal(defaultKioskSalesPolicy("property4").shortStayTimeRestricted, false)
})

test("supports a configured sale window across midnight", () => {
  const policy = {
    ...defaultKioskSalesPolicy("property4"),
    overnightTimeRestricted: true,
    overnightSaleStartTime: "22:00",
    overnightSaleEndTime: "02:00",
  }
  assert.equal(isKioskSalesWindowOpen(policy, "overnight", new Date("2026-09-04T14:00:00Z")), true)
  assert.equal(isKioskSalesWindowOpen(policy, "overnight", new Date("2026-09-04T16:00:00Z")), true)
  assert.equal(isKioskSalesWindowOpen(policy, "overnight", new Date("2026-09-04T03:00:00Z")), false)
})

import assert from "node:assert/strict"
import test from "node:test"
import { defaultKioskSalesPolicy, isKioskSalesWindowOpen } from "../lib/kiosk-sales-config.ts"

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

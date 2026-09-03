import assert from "node:assert/strict"
import test from "node:test"
import { buildOnSiteSheetDateTimes, normalizeDate } from "../lib/date-utils.ts"

test("normalizes Google Sheets date-time values", () => {
  assert.equal(normalizeDate("2026. 9. 5 오전 11:00:00"), "2026-09-05")
  assert.equal(normalizeDate("26.09.05/11:00"), "2026-09-05")
})

test("uses the current check-in time and a three-hour short-stay checkout", () => {
  assert.deepEqual(
    buildOnSiteSheetDateTimes("2026-09-05", "2026-09-05", "shortStay", new Date("2026-09-05T02:00:00Z")),
    {
      checkInDate: "26.09.05/11:00",
      checkOutDate: "26.09.05/14:00",
      scheduledCheckInAt: "26.09.05/11:00",
      scheduledCheckOutAt: "26.09.05/14:00",
    },
  )

  assert.deepEqual(
    buildOnSiteSheetDateTimes("2026-09-05", "2026-09-06", "overnight", new Date("2026-09-05T02:00:00Z")),
    {
      checkInDate: "26.09.05/11:00",
      checkOutDate: "26.09.06/11:00",
      scheduledCheckInAt: "26.09.05/11:00",
      scheduledCheckOutAt: "26.09.06/11:00",
    },
  )
})

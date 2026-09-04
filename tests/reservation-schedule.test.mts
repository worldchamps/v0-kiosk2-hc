import assert from "node:assert/strict"
import test from "node:test"
import { buildOnSiteSheetDateTimes, formatDateTimeKorean, normalizeDate, resolveReservationSheetDateTime } from "../lib/date-utils.ts"

test("normalizes Google Sheets date-time values", () => {
  assert.equal(normalizeDate("2026. 9. 5 오전 11:00:00"), "2026-09-05")
  assert.equal(normalizeDate("26.09.05/11:00"), "2026-09-05")
})

test("reservation reads use the date columns", () => {
  assert.equal(resolveReservationSheetDateTime("26.09.05/12:10", "15:00"), "26.09.05/12:10")
  assert.equal(resolveReservationSheetDateTime("2026-09-05", "15:00"), "26.09.05/15:00")
  assert.equal(resolveReservationSheetDateTime("", "15:00"), "")
})

test("formats reservation date-column values with their recorded time", () => {
  assert.equal(formatDateTimeKorean("2026. 9. 5 오후 3:10:00"), "2026년 09월 05일 15:10")
  assert.equal(formatDateTimeKorean("26.09.05/11:00"), "2026년 09월 05일 11:00")
})

test("uses the current check-in time and a three-hour short-stay checkout", () => {
  assert.deepEqual(
    buildOnSiteSheetDateTimes("2026-09-05", "2026-09-05", "shortStay", new Date("2026-09-05T02:00:00Z")),
    {
      checkInDate: "26.09.05/11:00",
      checkOutDate: "26.09.05/14:00",
    },
  )

  assert.deepEqual(
    buildOnSiteSheetDateTimes("2026-09-05", "2026-09-06", "overnight", new Date("2026-09-05T02:00:00Z")),
    {
      checkInDate: "26.09.05/11:00",
      checkOutDate: "26.09.06/11:00",
    },
  )
})

test("uses PMS-managed stay duration and overnight checkout time", () => {
  assert.deepEqual(
    buildOnSiteSheetDateTimes(
      "2026-09-05",
      "2026-09-05",
      "shortStay",
      new Date("2026-09-05T02:00:00Z"),
      { shortStayDurationMinutes: 240 },
    ),
    { checkInDate: "26.09.05/11:00", checkOutDate: "26.09.05/15:00" },
  )
  assert.deepEqual(
    buildOnSiteSheetDateTimes(
      "2026-09-05",
      "2026-09-06",
      "overnight",
      new Date("2026-09-05T02:00:00Z"),
      { overnightCheckoutTime: "12:30" },
    ),
    { checkInDate: "26.09.05/11:00", checkOutDate: "26.09.06/12:30" },
  )
})

import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import vm from "node:vm"
import ts from "typescript"
import * as React from "react"
import * as jsxRuntime from "react/jsx-runtime"
import { renderToStaticMarkup } from "react-dom/server"
import * as dates from "../lib/date-utils.ts"
import * as kioskScope from "../lib/kiosk-scope.ts"

test("scheduled entry is closed until the exact H-column time, in KST", () => {
  const before = new Date("2026-09-06T05:59:59.999Z")
  const at = new Date("2026-09-06T06:00:00Z")
  for (const value of [
    "26.09.06/15:00", "'26.09.06/15:00", "2026-09-06T15:00",
    "2026. 9. 6 오후 3:00:00", "2026.09.06 3:00 PM",
  ]) {
    const blocked = dates.getReservationCheckInEligibility(value, before)
    assert.equal(blocked.allowed, false, value)
    assert.equal(blocked.code, "CHECK_IN_NOT_OPEN")
    assert.match(blocked.message, /15:00부터/)
    assert.equal(dates.getReservationCheckInEligibility(value, at).allowed, true, value)
    assert.equal(dates.getReservationCheckInEligibility(value, new Date(at.getTime() + 60000)).allowed, true)
  }
})

test("midnight, future dates and nonstandard recorded entry times use the full timestamp", () => {
  assert.equal(dates.getReservationCheckInEligibility("26.09.07/00:00", new Date("2026-09-06T14:59:59Z")).allowed, false)
  assert.equal(dates.getReservationCheckInEligibility("26.09.07/00:00", new Date("2026-09-06T15:00:00Z")).allowed, true)
  assert.equal(dates.getReservationCheckInEligibility("26.09.07/15:00", new Date("2026-09-06T15:00:00Z")).allowed, false)
  assert.equal(dates.getReservationCheckInEligibility("26.09.06/18:30", new Date("2026-09-06T09:29:59Z")).allowed, false)
  assert.equal(dates.getReservationCheckInEligibility("26.09.06/18:30", new Date("2026-09-06T09:30:00Z")).allowed, true)
})

test("legacy date-only entry defaults to 15:00, but malformed schedules fail closed", () => {
  for (const value of ["26.09.06", "2026-09-06", "2026. 9. 6.", "09/06/2026"]) {
    assert.equal(dates.getReservationCheckInEligibility(value, new Date("2026-09-06T05:59:59Z")).allowed, false, value)
    assert.equal(dates.getReservationCheckInEligibility(value, new Date("2026-09-06T06:00:00Z")).allowed, true, value)
  }
  for (const value of [
    undefined, "", "garbage", "26.02.30/15:00", "26.13.01/15:00", "26.09.06/24:00",
    "26.09.06/15:60", "26.09.06/15:xx", "26.09.06/", "26.09.06 오후 15:00",
    "26.09.06/15:00abc", "26.09.06/15:00:60",
  ]) {
    const result = dates.getReservationCheckInEligibility(value, new Date("2026-09-07T00:00:00Z"))
    assert.equal(result.allowed, false, String(value))
    assert.equal(result.code, "INVALID_CHECK_IN_TIME", String(value))
  }
})

// Execute the real API handlers with in-memory Sheets/Firebase; no network,
// credentials, real reservations or hardware are used by this regression test.
function loadModule(path: string, dependencies: Record<string, unknown>) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8")
  const exports: Record<string, any> = {}
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  })
  vm.runInNewContext(compiled.outputText, {
    exports,
    require: (name: string) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
    process: { env: { GOOGLE_SHEETS_SPREADSHEET_ID: "test-sheet" } },
    console: { log() {}, error() {} },
    Date, URL,
  })
  return exports
}

function createApiHarness(checkInDate: string, now: string) {
  const columns = loadModule("../lib/google-sheets.ts", { googleapis: { google: {} } }).SHEET_COLUMNS
  const row = ["test-property", "Test Guest", "test-reservation", "test-platform", "test-room", "100", "",
    checkInDate, "26.09.07/11:00", "A101", "test-password", "", "", "1"]
  const writes: any[] = []
  const queue: any[] = []
  const values = {
    get: async () => ({ data: { values: [row] } }),
    batchUpdate: async (request: any) => { writes.push(request) },
  }
  const dependencies = {
    "@/lib/kiosk-scope": { ...kioskScope, getKioskScope: () => kioskScope.getKioskScope({ KIOSK_PROPERTY_ID: "property1" }) },
    "next/server": { NextResponse: Response },
    "next/headers": { headers: async () => new Headers() },
    "@/lib/google-sheets": { createSheetsClient: () => ({ spreadsheets: { values } }), SHEET_COLUMNS: columns },
    "@/lib/firebase-admin": { addToPMSQueue: async (request: any) => { queue.push(request) } },
    "@/lib/check-in-operation": { completeReservationCheckIn: async (input: any) => {
      const checkInTime = new Date(now).toISOString()
      await input.writeCheckIn(checkInTime)
      queue.push(input)
      return { success: true, data: { reservationId: input.reservationId, checkInTime,
        status: "Checked In", roomNumber: input.roomNumber, password: input.password, floor: input.floor } }
    } },
    "@/lib/property-utils": {
      getPropertyFromReservation: () => "property1",
      canCheckInAtKiosk: () => ({ allowed: true }),
    },
    "@/lib/aligo-sms": {},
    "@/lib/date-utils": {
      ...dates,
      getReservationCheckInEligibility: (value: string) => dates.getReservationCheckInEligibility(value, new Date(now)),
      getReservationStayEligibility: (start: string, end: string) => dates.getReservationStayEligibility(start, end, new Date(now)),
    },
  }
  const { POST } = loadModule("../app/api/check-in/route.ts", dependencies)
  const { GET } = loadModule("../app/api/reservations/route.ts", dependencies)
  return {
    row, writes, queue,
    search: () => GET(new Request("http://test.local/api/reservations?reservationId=test-reservation")),
    checkIn: (extra = {}) => POST(new Request("http://test.local/api/check-in", {
      method: "POST",
      body: JSON.stringify({ reservationId: "test-reservation", kioskProperty: "property1", ...extra }),
    })),
  }
}

test("early direct API requests cannot write check-in state, enqueue PMS, or reveal the password", async () => {
  const api = createApiHarness("26.09.06/15:00", "2026-09-06T05:59:59Z")
  const search = await (await api.search()).json()
  assert.equal(search.reservations.length, 1)
  assert.equal(search.reservations[0].checkInDateTime, "26.09.06/15:00")
  assert.equal(search.reservations[0].password, "")
  for (const extra of [{}, { adminOverride: true, checkInDate: "26.09.06/00:00" }]) {
    const response = await api.checkIn(extra)
    assert.equal(response.status, 409)
    const body = await response.json()
    assert.equal(body.code, "CHECK_IN_NOT_OPEN")
    assert.equal(body.data, undefined)
    assert.equal(body.password, undefined)
  }
  assert.equal(api.writes.length, 0)
  assert.equal(api.queue.length, 0)
})

test("entry at the scheduled time completes the existing flow without changing planned H/I", async () => {
  const api = createApiHarness("26.09.06/15:00", "2026-09-06T06:00:00Z")
  const response = await api.checkIn()
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.success, true)
  assert.equal(body.data.password, "test-password")
  assert.equal(api.writes.length, 1)
  assert.deepEqual(Array.from(api.writes[0].requestBody.data, (entry: any) => entry.range), ["Reservations!L2", "Reservations!M2"])
  assert.equal(api.queue.length, 1)
  assert.equal(api.queue[0].checkInDate, "26.09.06/15:00")
})

test("an H-column change after lookup is enforced at submission; bad H never writes", async () => {
  const api = createApiHarness("26.09.06/15:00", "2026-09-06T06:00:00Z")
  await api.search()
  api.row[7] = "26.09.06/17:30"
  const response = await api.checkIn()
  assert.equal(response.status, 409)
  assert.match((await response.json()).message, /17:30부터/)
  api.row[7] = "26.09.06/invalid"
  const invalid = await api.checkIn()
  assert.equal(invalid.status, 409)
  assert.equal((await invalid.json()).code, "INVALID_CHECK_IN_TIME")
  assert.equal(api.writes.length, 0)
  assert.equal(api.queue.length, 0)
})

test("cancelled, checked-out and unknown terminal statuses cannot be checked in through direct POST", async () => {
  for (const status of ["Canceled", "Cancelled", "취소", "예약취소", "Checked Out", "unknown"]) {
    const api = createApiHarness("26.09.06/15:00", "2026-09-06T06:00:00Z")
    api.row[11] = status
    const response = await api.checkIn({ adminOverride: true })
    assert.equal(response.status, 409, status)
    assert.equal((await response.json()).error, "RESERVATION_NOT_ACTIVE")
    assert.equal(api.writes.length, 0); assert.equal(api.queue.length, 0)
  }
})

test("malformed reservation IDs are rejected before check-in effects", async () => {
  for (const reservationId of [null, {}, [], 123, "", "x".repeat(201)]) {
    const api = createApiHarness("26.09.06/15:00", "2026-09-06T06:00:00Z")
    assert.equal((await api.checkIn({ reservationId })).status, 400)
    assert.equal(api.writes.length, 0); assert.equal(api.queue.length, 0)
  }
})

test("reservation details disable early entry with a visible time, and enable it when due", () => {
  let now = new Date("2026-09-06T05:59:59Z")
  const { default: Details } = loadModule("../components/reservation-details.tsx", {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "@/components/ui/button": { Button: "button" },
    "@/components/ui/card": { Card: "div", CardContent: "div" },
    "next/image": { default: () => null },
    "lucide-react": {},
    "@/lib/date-utils": {
      ...dates,
      getReservationCheckInEligibility: (value: string) => dates.getReservationCheckInEligibility(value, now),
    },
    "@/lib/room-utils": {},
    "@/lib/audio-utils": {},
    "@/hooks/use-idle-timer": { useIdleTimer() {} },
    "@/lib/location-utils": { getLocationTitle: () => "Test Kiosk" },
    "@/lib/property-utils": {},
    "@/components/smoking-policy-dialog": { default: () => null },
  })
  const props = {
    reservation: { reservationId: "test", guestName: "Test", roomType: "Test",
      checkInDateTime: "26.09.06/15:00", checkOutDateTime: "26.09.07/11:00" },
    onCheckIn: async () => false,
    onNavigate() {},
    kioskLocation: "A",
  }
  const before = renderToStaticMarkup(React.createElement(Details, props))
  assert.match(before, /15:00부터 체크인/)
  assert.match(before, /<button[^>]*disabled=""[^>]*>입실 시간 전<\/button>/)
  now = new Date("2026-09-06T06:00:00Z")
  const at = renderToStaticMarkup(React.createElement(Details, props))
  assert.doesNotMatch(at, /disabled=""|입실 시간 전/)
  assert.match(at, />체크인<\/button>/)
})

test("new on-site UUID reservations cannot expose room credentials through the legacy checked-in path", async () => {
  const api = createApiHarness("26.09.06/15:00", "2026-09-06T06:00:00Z")
  const reservationId = "ONSITE-00000000-0000-4000-8000-000000000001"
  api.row[2] = reservationId; api.row[11] = "Checked In"
  const response = await api.checkIn({ reservationId })
  assert.equal(response.status, 409)
  const body = await response.json()
  assert.equal(body.error, "ON_SITE_BOOKING_RECOVERY_REQUIRED")
  assert.equal(body.data, undefined)
  assert.equal(api.writes.length, 0); assert.equal(api.queue.length, 0)
})

test("short-stay and overnight entry remain allowed until, but not at, their exact checkout time", () => {
  for (const [start, end, before, at] of [
    ["26.09.06/15:00", "26.09.06/18:00", "2026-09-06T08:59:59.999Z", "2026-09-06T09:00:00Z"],
    ["26.09.06/15:00", "26.09.07/11:00", "2026-09-07T01:59:59.999Z", "2026-09-07T02:00:00Z"],
    ["26.09.06/23:30", "26.09.07/02:30", "2026-09-06T17:29:59.999Z", "2026-09-06T17:30:00Z"],
    ["26.09.06", "26.09.07", "2026-09-07T01:59:59.999Z", "2026-09-07T02:00:00Z"],
  ]) {
    assert.equal(dates.getReservationStayEligibility(start, end, new Date(before)).allowed, true, end)
    const expired = dates.getReservationStayEligibility(start, end, new Date(at))
    assert.equal(expired.allowed, false, end); assert.equal(expired.code, "RESERVATION_EXPIRED")
  }
})

test("checkout parsing rejects missing, malformed, impossible and non-increasing schedules", () => {
  for (const end of [undefined, "", "garbage", "26.02.30/11:00", "26.09.07/24:00",
    "26.09.07/11:60", "26.09.07/11:00:60", "26.09.07/11:xx", "26.09.07/",
    "26.09.07/11:00junk", "26.09.06/15:00", "26.09.06/14:00"]) {
    const result = dates.getReservationStayEligibility("26.09.06/15:00", end, new Date("2026-09-06T06:00:00Z"))
    assert.equal(result.allowed, false, String(end)); assert.equal(result.code, "INVALID_CHECK_OUT_TIME", String(end))
  }
  for (const end of ["'26.09.07/11:00", "2026-09-07T11:00", "2026. 9. 7 오전 11:00:00", "09/07/2026"]) {
    assert.equal(dates.getReservationStayEligibility("26.09.06/15:00", end, new Date("2026-09-07T01:59:59Z")).allowed, true, end)
  }
})

test("expired unpaid, legacy completed and durable completed reservations cannot reach the credential-returning operation", async () => {
  for (const status of ["", "Checked In"]) {
    const api = createApiHarness("26.09.06/15:00", "2026-09-10T03:00:00Z")
    api.row[11] = status; api.row[12] = status ? "2026-09-06T06:00:00Z" : ""
    const response = await api.checkIn({ adminOverride: true })
    assert.equal(response.status, 409, status)
    const body = await response.json()
    assert.equal(body.code, "RESERVATION_EXPIRED")
    assert.equal(body.data, undefined); assert.equal(body.password, undefined)
    assert.equal(api.writes.length, 0); assert.equal(api.queue.length, 0)
  }
})

test("fresh I-column changes and invalid checkout values stop direct API writes and password disclosure", async () => {
  const api = createApiHarness("26.09.06/15:00", "2026-09-06T09:00:00Z")
  await api.search()
  for (const end of ["26.09.06/18:00", "", "26.09.07/25:00", "26.09.06/14:00"]) {
    api.row[8] = end
    const response = await api.checkIn({ checkOutDate: "2099-01-01" })
    assert.equal(response.status, 409, end)
    assert.equal((await response.json()).data, undefined)
  }
  assert.equal(api.writes.length, 0); assert.equal(api.queue.length, 0)
})

test("valid ongoing short-stay and overnight direct requests keep the existing successful flow", async () => {
  for (const [end, now] of [["26.09.06/18:00", "2026-09-06T08:59:59Z"], ["26.09.07/11:00", "2026-09-07T01:59:59Z"]]) {
    const api = createApiHarness("26.09.06/15:00", now); api.row[8] = end
    const response = await api.checkIn()
    assert.equal(response.status, 200); assert.equal((await response.json()).data.password, "test-password")
    assert.equal(api.writes.length, 1); assert.equal(api.queue.length, 1)
  }
})

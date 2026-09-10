const assert = require("node:assert/strict")
const test = require("node:test")
const { readFileSync } = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

// Real handlers and parsers, with every external dependency replaced in memory.
function load(file, dependencies = {}, globals = {}) {
  const exports = {}
  const source = readFileSync(path.join(__dirname, "..", file), "utf8")
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  vm.runInNewContext(compiled.outputText, {
    exports, require(name) {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
    process: { env: { GOOGLE_SHEETS_SPREADSHEET_ID: "memory-sheet" } },
    console: { log() {}, warn() {}, error() {} }, Date, URL, ...globals,
  }, { filename: file })
  return exports
}
const next = { NextResponse: { json: (data, options) => Response.json(data, options) } }
const properties = load("lib/property-utils.ts")
const dates = load("lib/date-utils.ts")
const columns = load("lib/google-sheets.ts", { googleapis: { google: {} } }).SHEET_COLUMNS
const scope = load("lib/kiosk-scope.ts")
const salesConfig = load("lib/kiosk-sales-config.ts")
function ratesHarness(data = {}) {
  const reads = []
  const rates = load("lib/pms-rates.ts", {
    "@/lib/property-utils": properties,
    "@/lib/firebase-admin": { getDB: () => ({ ref: name => ({ once: async () => {
      reads.push(name)
      if (data instanceof Error) throw data
      return { val: () => data[name] ?? null }
    } }) }) },
  })
  return { rates, reads }
}
const room = (number, type, amount) => ({ property: "property3", room: number, roomType: type,
  status: "공실", rates: { overnight: { card: amount, cash: amount }, shortStay: { card: amount, cash: amount } } })
const rateProperty = rooms => [{ property: "property3", timestamp: null, rooms }]

test("PMS fallback selects an explicit room building, never another building's same room number", () => {
  const { rates } = ratesHarness()
  const a = room("A101", "스탠다드", 40000)
  const b = room("B101", "스탠다드", 60000)
  assert.equal(rates.findPmsRateRoom(rateProperty([a, b]), "B101"), b)
  assert.equal(rates.findPmsRateRoom(rateProperty([a]), "B101"), null)
  assert.equal(rates.findPmsRateRoom(rateProperty([b]), "A101", "101호"), null)
})

test("PMS legacy numeric rooms retain building-type hints and reject ambiguous duplicates", () => {
  const { rates } = ratesHarness()
  const a = room("101호", "A동 디럭스", 40000)
  const b = room("101호", "B동 디럭스", 60000)
  assert.equal(rates.findPmsRateRoom(rateProperty([a, b]), "B101"), b)
  assert.equal(rates.findPmsRateRoom(rateProperty([a]), "B101"), null)
  const legacy = room("101", "디럭스", 50000)
  assert.equal(rates.findPmsRateRoom(rateProperty([legacy]), "B101"), legacy)
  assert.equal(rates.findPmsRateRoom(rateProperty([legacy, { ...legacy }]), "B101"), null)
  assert.equal(rates.findPmsRateRoom(rateProperty([b, { ...b }]), "B101"), null)
  assert.equal(rates.findPmsRateRoom(rateProperty([a]), "unknown"), null)
})

test("PMS read transport is property-scoped and safely normalizes sparse room data", async () => {
  const { rates, reads } = ratesHarness({ "pms_status/property3": { timestamp: 1e99, rooms: {
    deleted: null, valid: { room: "B101", roomType: "B동 디럭스", sukbakCard: "60,000원", daesilCash: 30000 },
  } } })
  const data = await rates.getPmsRateProperties(["property3", "property3"])
  assert.deepEqual(reads, ["pms_status/property3"])
  assert.equal(data[0].timestamp, null)
  assert.equal(data[0].rooms.length, 1)
  assert.equal(data[0].rooms[0].rates.overnight.card, 60000)
  assert.equal(data[0].rooms[0].rates.shortStay.cash, 30000)
})

async function available(rooms, pmsRooms) {
  const handler = load("app/api/available-rooms/route.ts", {
    "next/server": next,
    "@/lib/property-utils": properties,
    "@/lib/kiosk-scope": { ...scope, getKioskScope: () => ({ property: "property3", building: "B" }) },
    "@/lib/firebase-beach-rooms": { getAvailableRooms: async () => rooms },
    "@/lib/pms-rates": { ...ratesHarness().rates, getPmsRateProperties: async () => rateProperty(pmsRooms) },
    "@/lib/kiosk-sales-config": { ...salesConfig, getKioskSalesConfig: async () => null },
  })
  return handler.GET(new Request("http://offline.invalid/api/available-rooms?location=A"))
}
const beachRoom = code => ({ category: `Beach ${code[0]}`, roomNumber: "101호", roomType: "스탠다드",
  password: "DO-NOT-EXPOSE", status: "공실", floor: "1", matchingRoomNumber: code })

test("available rooms ignores a cross-building query and never returns prepayment door codes", async () => {
  const response = await available([beachRoom("A101"), beachRoom("B101")], [room("A101", "스탠다드", 40000), room("B101", "스탠다드", 60000)])
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(data.total, 1)
  assert.equal(data.availableRooms[0].roomCode, "B101")
  assert.equal(data.availableRooms[0].rates.overnight.card, 60000)
  assert.equal(JSON.stringify(data).includes("DO-NOT-EXPOSE"), false)
})

test("available rooms does not sell a room using a different building's fallback rate", async () => {
  const response = await available([beachRoom("B101")], [room("A101", "A동 디럭스", 40000)])
  assert.equal(response.status, 200)
  assert.equal((await response.json()).total, 0)
})

const reservation = (id, status = "", inDate = "26.09.10/15:00", outDate = "26.09.11/11:00") =>
  ["비치", "Test Guest", id, "test", "디럭스", "60,000", "01000000000", inDate, outDate, "B101", "DO-NOT-EXPOSE", status, "", "1"]
function sheetRoute(file, rows, env) {
  const reads = []
  const handler = load(file, {
    "next/server": next,
    "@/lib/google-sheets": { SHEET_COLUMNS: columns, createSheetsClient: () => ({ spreadsheets: { values: {
      get: async args => { reads.push(args); if (rows instanceof Error) throw rows; return { data: { values: rows } } },
    } } }) },
    "@/lib/date-utils": dates,
    "@/lib/property-utils": properties,
    "@/lib/kiosk-scope": { ...scope, getKioskScope: () => ({ property: "property3", building: "B" }) },
  }, env ? { process: { env } } : {})
  return { handler, reads }
}

test("reservation listing excludes processed/name-mismatched/cross-building rows without disclosing keys", async () => {
  const wrongBuilding = reservation("a"); wrongBuilding[9] = "A101"
  const wrongGuest = reservation("other"); wrongGuest[1] = "Other Guest"
  const { handler } = sheetRoute("app/api/reservations/route.ts", [reservation("valid"), reservation("done", "Checked In"),
    reservation("canceled", "Cancelled"), wrongBuilding, wrongGuest])
  const data = await (await handler.GET(new Request("http://offline.invalid/api/reservations?name=Test%20Guest&searchAll=true&kioskProperty=property1"))).json()
  assert.deepEqual(data.reservations.map(value => value.reservationId), ["valid"])
  assert.equal(data.reservations[0].checkInDateTime, "26.09.10/15:00")
  assert.equal(JSON.stringify(data).includes("DO-NOT-EXPOSE"), false)
})

test("admin reservations composes status/date/type/place filters without returning door codes", async () => {
  const { handler } = sheetRoute("app/api/admin/reservations/route.ts", [reservation("checked", "Checked In"), reservation("waiting")])
  const response = await handler.GET(new Request("http://offline.invalid/api/admin/reservations?status=Checked%20In&date=2026-09-11&roomType=디럭스&place=비치"))
  const data = await response.json()
  assert.equal(data.total, 1)
  assert.equal(data.reservations[0].reservationId, "checked")
  assert.equal(JSON.stringify(data).includes("DO-NOT-EXPOSE"), false)
})

test("monthly sales filters by normalized month and does not disclose archived door codes", async () => {
  const { handler } = sheetRoute("app/api/sales/route.ts", [reservation("sep"), reservation("aug", "", "26.08.31/15:00", "26.09.01/11:00")])
  const response = await handler.GET(new Request("http://offline.invalid/api/sales?month=9&year=2026"))
  const data = await response.json()
  assert.equal(data.total, 1)
  assert.equal(data.sales[0].reservationId, "sep")
  assert.equal(data.sales[0].price, "60,000")
  assert.equal(JSON.stringify(data).includes("DO-NOT-EXPOSE"), false)
})

test("Sheets read APIs handle empty, unavailable, and unconfigured data without any writes", async () => {
  for (const file of ["app/api/reservations/route.ts", "app/api/admin/reservations/route.ts", "app/api/sales/route.ts"]) {
    const request = new Request("http://offline.invalid/api/read")
    assert.equal((await sheetRoute(file, []).handler.GET(request)).status, 200)
    assert.equal((await sheetRoute(file, new Error("offline failure")).handler.GET(request)).status, 500)
    const missing = sheetRoute(file, [], {})
    assert.equal((await missing.handler.GET(request)).status, 500)
    assert.equal(missing.reads.length, 0)
  }
})

test("room status composes room/building/floor filters and handles an unavailable transport", async () => {
  for (const fail of [false, true]) {
    const handler = load("app/api/room-status/route.ts", { "next/server": next,
      "@/lib/firebase-beach-rooms": { getBeachRoomStatusFromFirebase: async () => {
        if (fail) throw new Error("offline failure")
        return [beachRoom("A101"), beachRoom("B101")]
      } },
    })
    const response = await handler.GET(new Request("http://offline.invalid/api/room-status?building=Beach%20B&roomNumber=101&floor=1"))
    assert.equal(response.status, fail ? 500 : 200)
    if (!fail) {
      const data = await response.json()
      assert.equal(data.total, 1)
      assert.equal(data.rooms[0].matchingRoomNumber, "B101")
      assert.equal(JSON.stringify(data).includes("DO-NOT-EXPOSE"), false)
    }
  }
})

test("PMS rates API selects the requested property, disables caching and contains transport errors", async () => {
  for (const fail of [false, true]) {
    const reads = []
    const handler = load("app/api/pms-rates/route.ts", { "next/server": next,
      "@/lib/pms-rates": { getPmsRateProperties: async selected => {
        reads.push(...selected)
        if (fail) throw new Error("offline failure")
        return [{ property: "property3", timestamp: null, rooms: [] }]
      } },
    })
    const response = await handler.GET(new Request("http://offline.invalid/api/pms-rates?property=property3"))
    assert.deepEqual(reads, ["property3"])
    assert.equal(response.status, fail ? 500 : 200)
    if (!fail) assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0")
  }
})

import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import vm from "node:vm"
import ts from "typescript"
import * as scope from "../lib/kiosk-scope.ts"
import * as properties from "../lib/property-utils.ts"
import * as dates from "../lib/date-utils.ts"
import * as sales from "../lib/kiosk-sales-config.ts"
import * as firebaseTransaction from "../lib/firebase-transaction.ts"

// Real handlers with in-memory dependencies. No customer data, payment,
// Firebase writes, PC commands, or printers are contacted by these tests.
function load(path: string, dependencies: Record<string, any>, env: NodeJS.ProcessEnv = {}, globals = {}) {
  const exports: Record<string, any> = {}
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  })
  vm.runInNewContext(compiled.outputText, {
    exports, require(name: string) {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
    process: { env }, console: { log() {}, warn() {}, error() {} }, Date, URL, ...globals,
  })
  return exports
}

const columns = load("../lib/google-sheets.ts", { googleapis: { google: {} } }).SHEET_COLUMNS
const room = (code: string) => ({
  matchingRoomNumber: code, roomNumber: code.slice(1), category: `Beach ${code[0]}`,
  roomType: "Test", password: "test-password", status: "공실", floor: "1F",
})
const reservation = (code: string) => ["비치 A,B동", "Test Guest", `id-${code}`, "test", "Test", "100", "000",
  "26.09.06/15:00", "26.09.07/11:00", code, "test-password", "", "", "1F"]
class ScopeTestDate extends Date {
  constructor(value?: string | number) { super(value ?? "2026-09-06T06:00:00Z") }
  static now() { return new ScopeTestDate().getTime() }
}

function harness(building: string | undefined = "A", property = "property3") {
  const env = { KIOSK_PROPERTY_ID: property, ...(building === undefined ? {} : { KIOSK_BUILDING: building }),
    GOOGLE_SHEETS_SPREADSHEET_ID: "test-sheet" }
  const effects: string[] = []
  const bookingRecords = new Map<string, any>()
  const rows = [reservation("A131"), reservation("B121"), reservation("D211"), reservation("")]
  const rooms = [room("A131"), room("B121"), room("D211")]
  const values = {
    get: async () => ({ data: { values: rows } }),
    batchUpdate: async () => { effects.push("check-in") },
    append: async () => { effects.push("booking") },
  }
  const dependencies: Record<string, any> = {
    "@/lib/firebase-transaction": firebaseTransaction,
    "next/server": { NextResponse: Response },
    "next/headers": { headers: async () => new Headers() },
    "@/lib/kiosk-scope": { ...scope, getKioskScope: () => scope.getKioskScope(env) },
    "@/lib/property-utils": properties,
    "@/lib/google-sheets": { SHEET_COLUMNS: columns, createSheetsClient: () => ({ spreadsheets: { values } }) },
    "@/lib/date-utils": { ...dates,
      getReservationCheckInEligibility: (value: string) => dates.getReservationCheckInEligibility(value, new Date("2026-09-06T06:00:00Z")),
      getReservationStayEligibility: (start: string, end: string) => dates.getReservationStayEligibility(start, end, new Date("2026-09-06T06:00:00Z")) },
    "@/lib/firebase-admin": {
      getPaymentClaim: async () => null,
      addToPMSQueue: async () => { effects.push("queue") },
      claimPayment: async () => { effects.push("claim"); return true },
      releasePaymentClaim: async () => { effects.push("release") },
    },
    "@/lib/check-in-operation": { completeReservationCheckIn: async (input: any) => {
      await input.writeCheckIn("2026-09-06T06:00:00Z")
      effects.push("queue")
      return { success: true, data: { roomNumber: input.roomNumber } }
    } },
    // Scope tests stop at the workflow boundary; real-store concurrency/fault
    // contracts are exercised separately in on-site-booking.test.cjs.
    "@/lib/on-site-bookings": {
      bookingRoomKey: (value: string) => value.replace(/[\s-]+/g, "").toUpperCase(),
      bookingHash: (value: string) => value,
      readOnSiteBooking: async () => null, beginOnSiteBooking: async () => true,
      claimOnSiteRoom: async () => true, rejectOnSiteBooking: async () => {},
      bookingRecordRef: (key: string) => ({
        on: () => {}, off: () => {},
        once: async () => ({ val: () => bookingRecords.get(key) }),
        set: async (value: any) => { bookingRecords.set(key, structuredClone(value)) },
        transaction: async (callback: (current: any) => any) => {
          const next = callback(bookingRecords.get(key))
          if (next !== undefined) bookingRecords.set(key, next)
          return { committed: next !== undefined, snapshot: { val: () => bookingRecords.get(key) } }
        },
      }),
      reservationTimestamp: () => Date.now() + 86400000,
      roomScheduleConflicts: () => false,
      finalizeOnSiteBooking: async (record: any) => {
        effects.push("room-status", "queue")
        return { ...record, state: "complete" }
      },
    },
    "@/lib/firebase-beach-rooms": {
      // Deliberately return mixed buildings: the endpoint must still filter.
      getAvailableRooms: async () => rooms,
      getRoomInfoByMatchingNumber: async (code: string) => rooms.find((item) => item.matchingRoomNumber === code),
      updateRoomStatusInFirebase: async () => { effects.push("room-status"); return true },
    },
    "@/lib/kiosk-sales-config": { ...sales, getKioskSalesConfig: async () => null },
    "@/lib/pms-rates": {
      getPmsRateProperties: async () => [], getPmsRateAmount: async () => 100,
      findPmsRateRoom: () => ({ rates: { overnight: { card: 100, cash: 100 }, shortStay: { card: 100, cash: 100 } } }),
    },
    "@/lib/short-stay-policy": { isShortStayRestrictedProperty: () => false },
    "@/lib/aligo-sms": {},
    "@/lib/toss-pay": { verifyCompletedCardPayment: async () => { effects.push("verify-payment") },
      createTossPayment: async () => { effects.push("create-payment"); return {} } },
    "@/lib/toss-front": { verifyTossFrontPaymentProof: () => { effects.push("verify-front") } },
    "@/lib/on-site-pricing": { getOnSiteRate: () => 100 },
    crypto: { randomUUID: () => "test-order" },
  }
  return {
    env, effects, rows, rooms, dependencies,
    get: (name: string, query = "") => load(`../app/api/${name}/route.ts`, dependencies, env).GET(new Request(`http://test.local/api/${name}?${query}`)),
    post: (name: string, body: unknown) => load(`../app/api/${name}/route.ts`, dependencies, env, { Date: ScopeTestDate }).POST(new Request(`http://test.local/api/${name}`, {
      method: "POST", body: JSON.stringify(body),
    })),
  }
}

test("device scope is runtime-only, mandatory for property3, and leaves other properties unpartitioned", () => {
  for (const building of ["A", "B"]) {
    assert.equal(scope.getKioskScope({ KIOSK_PROPERTY_ID: "property3", KIOSK_BUILDING: building }).building, building)
    assert.equal(scope.getKioskScope({ NEXT_PUBLIC_KIOSK_PROPERTY_ID: "property3", KIOSK_BUILDING: building }).building, building)
  }
  for (const building of [undefined, "", "C", "AB", "ALL", "a", " A "]) {
    assert.throws(() => scope.getKioskScope({ KIOSK_PROPERTY_ID: "property3", KIOSK_BUILDING: building }), /KIOSK_BUILDING/)
  }
  assert.throws(() => scope.getKioskScope({ KIOSK_PROPERTY_ID: "bad", KIOSK_BUILDING: "A" }))
  for (const property of ["property1", "property2", "property4"]) {
    assert.equal(scope.getKioskScope({ KIOSK_PROPERTY_ID: property }).building, null)
  }
  assert.equal(scope.getKioskScope({ KIOSK_PROPERTY_ID: "property3", NEXT_PUBLIC_KIOSK_PROPERTY_ID: "property1", KIOSK_BUILDING: "B" }).building, "B")
  for (const value of ["A131", " a131 ", "A 131", "A-131"]) assert.equal(scope.isRoomInBuilding(value, "A"), true)
  for (const value of ["B131", "131", "A동", "A131,B131", "A131-extra", "", null, 131]) assert.equal(scope.isRoomInBuilding(value, "A"), false)
})

test("public config contains only property/building; missing scope fails closed before any effects", async () => {
  assert.deepEqual(await (await harness("B").get("kiosk-config")).json(), { property: "property3", building: "B" })
  const api = harness("")
  assert.equal((await api.get("kiosk-config")).status, 503)
  for (const name of ["available-rooms", "reservations"]) assert.equal((await api.get(name)).status, 500)
  for (const name of ["check-in", "on-site-booking", "toss-payments/create"]) {
    assert.ok((await api.post(name, { reservationId: "id-A131" })).status >= 500)
  }
  assert.deepEqual(api.effects, [])
})

test("A/B room listing ignores conflicting URLs and category labels; vacant/sale exclusions survive", async () => {
  for (const building of ["A", "B"]) {
    const api = harness(building)
    for (const query of ["", "location=ALL", "location=D", "location=A", "location=B"]) {
      const response = await api.get("available-rooms", query)
      assert.equal(response.status, 200)
      const body = await response.json()
      assert.equal(body.total, 1)
      assert.equal(body.availableRooms[0].roomCode[0], building)
      assert.equal(body.location, building)
    }
  }
  const api = harness()
  const blocked = ["A132", "A133", "A135"].map(room)
  const mixed = [...api.rooms, { ...room("B122"), category: "Beach A" },
    { ...blocked[0], status: "사용 중" }, { ...blocked[1], unavailable: "X" }, { ...blocked[2], vendingAvailable: false }]
  const firebase = load("../lib/firebase-beach-rooms.ts", {
    "@/lib/kiosk-scope": scope,
    "@/lib/property-utils": properties,
    "@/lib/on-site-bookings": {
      bookingRoomKey: (value: string) => value.replace(/[\s-]+/g, "").toUpperCase(),
      getBlockedOnSiteRooms: async () => new Set(),
    },
    "@/lib/firebase-admin": { getDB: () => ({ ref: () => ({ once: async () => ({ val: () => mixed }) }) }) },
  })
  assert.deepEqual(Array.from(await firebase.getAvailableRooms("A"), (item: any) => item.matchingRoomNumber), ["A131"])
  assert.deepEqual(Array.from(await firebase.getAvailableRooms("B"), (item: any) => item.matchingRoomNumber), ["B121", "B122"])
  assert.deepEqual(Array.from(await firebase.getAvailableRooms("D"), (item: any) => item.matchingRoomNumber), ["D211"])
})

test("name and QR lookups cannot bypass A/B scope with searchAll or a forged property", async () => {
  for (const building of ["A", "B"]) {
    const api = harness(building)
    for (const query of ["name=Test%20Guest", "searchAll=true", "kioskProperty=property1&searchAll=true"]) {
      const body = await (await api.get("reservations", query)).json()
      assert.equal(body.reservations.length, 1)
      assert.equal(body.reservations[0].roomNumber[0], building)
      assert.equal(body.reservations[0].password, "")
    }
    const otherId = building === "A" ? "id-B121" : "id-A131"
    assert.deepEqual((await (await api.get("reservations", `reservationId=${otherId}&searchAll=true`)).json()).reservations, [])
  }
})

test("check-in rechecks assigned room; missing/forged property and adminOverride cannot cross buildings", async () => {
  for (const building of ["A", "B"]) {
    const api = harness(building)
    for (const code of building === "A" ? ["B121", "D211", ""] : ["A131", "D211", ""]) {
      for (const extra of [{}, { kioskProperty: "property3", adminOverride: true }, { kioskProperty: "property1", kioskBuilding: building }]) {
        const response = await api.post("check-in", { reservationId: `id-${code}`, ...extra })
        assert.equal(response.status, 403)
        assert.equal((await response.json()).error, "KIOSK_BUILDING_MISMATCH")
      }
    }
    assert.deepEqual(api.effects, [])
    const code = building === "A" ? "A131" : "B121"
    assert.equal((await api.post("check-in", { reservationId: `id-${code}`, kioskProperty: "property3" })).status, 200)
    assert.deepEqual(api.effects, ["check-in", "queue"])
  }
  const api = harness("A")
  await api.get("reservations", "reservationId=id-A131")
  api.rows[0][columns.ROOM_NUMBER] = "B121"
  assert.equal((await api.post("check-in", { reservationId: "id-A131", roomNumber: "A131" })).status, 403)
  assert.deepEqual(api.effects, [])
})

test("on-site sale rejects foreign/unassigned rooms before payment checks or writes; own-room cash works", async () => {
  for (const building of ["A", "B"]) {
    const api = harness(building)
    const code = building === "A" ? "A131" : "B121"
    const body = { requestId: "qa-building-scope-request", roomNumber: code, roomCode: code, guestName: "Test Guest", phoneNumber: "000",
      roomType: "Test", building: `Beach ${building}`, price: 100,
      checkInDate: "2026-09-06", checkOutDate: "2026-09-07", stayType: "overnight", payment: { method: "CASH" } }
    for (const roomCode of [building === "A" ? "B121" : "A131", "D211", "", null]) {
      for (const method of ["CASH", "CARD"]) {
        assert.equal((await api.post("on-site-booking", { ...body, roomCode, payment: { method }, adminOverride: true })).status, 403)
      }
    }
    assert.deepEqual(api.effects, [])
    assert.equal((await api.post("on-site-booking", body)).status, 200)
    assert.deepEqual(api.effects, ["booking", "room-status", "queue"])
  }
})

test("foreign-building online payment is rejected before contacting the provider", async () => {
  const api = harness("A")
  for (const building of ["Beach B", "B동", "B", "Camp", "", null]) {
    assert.equal((await api.post("toss-payments/create", { building, roomType: "Test", stayType: "overnight" })).status, 403)
  }
  assert.deepEqual(api.effects, [])
})

test("print listeners use only their property and building and do not duplicate in-flight jobs", async () => {
  for (const building of ["A", "B"]) {
    let callback: any, cleanup: any, finishPrint: any
    const paths: string[] = [], printed: string[] = [], updated: string[] = []
    const { PrintQueueListener } = load("../components/print-queue-listener.tsx", {
      react: { useState: (value: any) => [value, () => {}], useEffect: (effect: any) => { cleanup = effect() } },
      "react/jsx-runtime": {}, "@/lib/kiosk-scope": scope,
      "@/lib/firebase-client": { getFirebaseDatabase: () => ({}) },
      "@/lib/printer-utils": { isPrinterConnected: () => true, autoConnectPrinter: async () => true,
        printRoomInfoReceipt: (data: any) => { printed.push(data.roomNumber); return new Promise((resolve) => { finishPrint = resolve }) } },
      "firebase/database": {
        ref: (_db: any, path: string) => path,
        onValue: (path: string, cb: any) => { paths.push(path); callback = cb; return () => { paths.push("unsubscribed") } },
        update: async (path: string) => { updated.push(path) },
      },
    })
    PrintQueueListener({ scope: { property: "property3", building } })
    const snapshot = { val: () => Object.fromEntries(["A131", "B121", "Camp211"].map((code) => [code,
      { status: "pending", action: "remote-print", roomNumber: code, password: "test" }])) }
    callback(snapshot)
    callback(snapshot)
    assert.deepEqual(paths, ["print_queue/property3"])
    assert.deepEqual(printed, [building === "A" ? "A131" : "B121"])
    finishPrint(true)
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(updated, [`print_queue/property3/${printed[0]}`])
    cleanup()
    assert.equal(paths.at(-1), "unsubscribed")
  }
})

test("kiosk UI waits for PC config, overrides a conflicting URL/location, and blocks on config failure", async () => {
  for (const configuredBuilding of ["A", "B", null]) {
    const state: any[] = [], effects: any[] = []
    let cursor = 0
    const element = (type: any, props: any) => ({ type, props })
    const dependencies: Record<string, any> = {
      react: {
        useState: (initial: any) => {
          const index = cursor++
          if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial
          return [state[index], (value: any) => { state[index] = typeof value === "function" ? value(state[index]) : value }]
        },
        useEffect: (effect: any) => { effects.push(effect) }, useRef: (value: any) => ({ current: value }),
      },
      "react/jsx-runtime": { jsx: element, jsxs: element },
      "next/navigation": { useRouter: () => ({}) },
      "@/lib/kiosk-scope": scope,
      "@/lib/property-utils": { ...properties, getKioskPropertyId: () => "property3" },
      "@/lib/location-utils": { getKioskLocation: () => "A" },
      "@/lib/audio-utils": { stopAllAudio() {}, pauseBGM() {}, resumeBGM() {} },
      "@/lib/reservation-qr": {},
      "@/contexts/payment-context": { usePayment: () => ({ paymentSession: { isActive: false } }) },
      "@/components/print-queue-listener": { PrintQueueListener: "PrintQueueListener" },
      "@/components/kiosk-progress": {},
    }
    for (const name of ["standby-screen", "idle-screen", "reservation-confirm", "current-location", "on-site-reservation",
      "reservation-details", "check-in-complete", "reservation-not-found", "reservation-list", "admin-keypad",
      "property-mismatch-dialog", "property-redirect-dialog"]) dependencies[`@/components/${name}`] = { default: name }
    const { default: Layout } = load("../components/kiosk-layout.tsx", dependencies, {}, {
      window: { location: { search: "?location=B", reload() {} }, electronAPI: {}, addEventListener() {}, removeEventListener() {} },
      document: { body: { classList: { add() {}, remove() {} } } },
      URLSearchParams,
      fetch: async () => Response.json(configuredBuilding ? { property: "property3", building: configuredBuilding } : { error: "Missing building" },
        { status: configuredBuilding ? 200 : 503 }),
    })
    const props = { initialLocation: configuredBuilding === "A" ? "B" : "A", onChangeMode() {} }
    const find = (node: any, type: string): any => {
      if (!node || typeof node !== "object") return null
      if (node.type === type) return node
      const children = node.props?.children
      for (const child of Array.isArray(children) ? children : [children]) {
        const match = find(child, type)
        if (match) return match
      }
      return null
    }
    assert.equal(find(Layout(props), "on-site-reservation"), null)
    for (const effect of effects.splice(0)) effect()
    await new Promise((resolve) => setImmediate(resolve))
    cursor = 0
    const rendered = Layout(props)
    if (configuredBuilding) {
      assert.equal(find(rendered, "on-site-reservation").props.location, configuredBuilding)
      assert.equal(find(rendered, "PrintQueueListener").props.scope.building, configuredBuilding)
    } else {
      assert.equal(find(rendered, "on-site-reservation"), null)
      assert.equal(find(rendered, "PrintQueueListener"), null)
      assert.match(JSON.stringify(rendered), /Missing building/)
    }
  }
})

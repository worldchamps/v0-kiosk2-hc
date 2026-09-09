import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import vm from "node:vm"
import ts from "typescript"
import * as crypto from "node:crypto"

function load(file: string, dependencies: Record<string, unknown>, env = {}) {
  const exports: Record<string, any> = {}
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(source, { exports, require(name: string) {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]
  }, process: { env }, console: { log() {}, error() {} }, Date, URL, Buffer })
  return exports
}

function harness() {
  const records = new Map<string, any>()
  const clone = (value: any) => value ? structuredClone(value) : null
  let sheetWrites = 0, commits = 0
  let writeMode = "ok", commitMode = "ok"
  let hold: Promise<void> | undefined
  let rowStatus = "", rowTime = ""
  const database = { ref(path = "") { return {
    once: async () => ({ val: () => clone(records.get(path)) }),
    transaction: async (callback: any) => {
      const next = callback(clone(records.get(path)))
      if (next !== undefined) records.set(path, clone(next))
      return { committed: next !== undefined, snapshot: { val: () => clone(records.get(path)) } }
    },
    update: async (updates: any) => {
      assert.equal(path, ""); commits++
      if (commitMode === "before") throw new Error("connection lost before commit")
      for (const [key, value] of Object.entries(updates)) records.set(key, clone(value))
      if (commitMode === "after") throw new Error("response lost after commit")
    },
  } } }
  const { completeReservationCheckIn } = load("../lib/check-in-operation.ts", {
    crypto, "@/lib/firebase-admin": { getDB: () => database },
  })
  const base = { property: "property3", reservationId: "test-reservation", roomNumber: "B121",
    guestName: "Test", checkInDate: "26.09.09/15:00", password: "fake-password", floor: "1",
    writeCheckIn: async (time: string) => {
      sheetWrites++
      if (hold) await hold
      if (writeMode !== "before") { rowStatus = "Checked In"; rowTime = time }
      if (writeMode !== "ok") throw new Error("Sheets response lost")
    } }
  return { records, base,
    run: (extra = {}) => completeReservationCheckIn({ ...base, currentStatus: rowStatus, currentCheckInTime: rowTime, ...extra }),
    setWriteMode: (value: string) => { writeMode = value },
    setCommitMode: (value: string) => { commitMode = value },
    holdWrite: (value: Promise<void>) => { hold = value },
    get sheetWrites() { return sheetWrites }, get commits() { return commits },
    queues: () => [...records.keys()].filter(k => k.startsWith("pms_queue/")),
  }
}

test("check-in writes L/M once and atomically records a '-' queue; retry after consumer deletion never requeues", async () => {
  const h = harness()
  assert.equal((await h.run()).success, true)
  assert.equal(h.sheetWrites, 1); assert.equal(h.commits, 1)
  assert.match(h.queues()[0], /^pms_queue\/property3\/-kiosk-checkin-/)
  h.records.delete(h.queues()[0])
  assert.equal((await h.run()).success, true)
  assert.equal(h.sheetWrites, 1); assert.equal(h.commits, 1); assert.equal(h.queues().length, 0)
})

test("concurrent same-reservation requests write and enqueue only once", async () => {
  const h = harness()
  let release!: () => void
  h.holdWrite(new Promise<void>(r => { release = r }))
  const first = h.run()
  await new Promise(r => setImmediate(r))
  assert.equal((await h.run()).pending, true)
  release()
  assert.equal((await first).success, true)
  assert.equal(h.sheetWrites, 1); assert.equal(h.commits, 1)
})

test("lost Sheets response recovers only from exact freshly read status/time, without a second write", async () => {
  const h = harness(); h.setWriteMode("after")
  assert.equal((await h.run()).pending, true)
  assert.equal((await h.run({ currentCheckInTime: "different" })).pending, true)
  assert.equal(h.commits, 0)
  assert.equal((await h.run()).success, true)
  assert.equal(h.sheetWrites, 1); assert.equal(h.commits, 1)
})

test("uncertain Sheets write absent from read stays pending and never writes again", async () => {
  const h = harness(); h.setWriteMode("before")
  assert.equal((await h.run()).pending, true)
  assert.equal((await h.run()).pending, true)
  assert.equal(h.sheetWrites, 1); assert.equal(h.commits, 0)
})

test("atomic commit failure before applying stays pending and is not blindly replayed", async () => {
  const h = harness(); h.setCommitMode("before")
  assert.equal((await h.run()).pending, true)
  h.setCommitMode("ok")
  assert.equal((await h.run()).pending, true)
  assert.equal(h.sheetWrites, 1); assert.equal(h.commits, 1); assert.equal(h.queues().length, 0)
})

test("atomic commit response loss observes complete on retry, even after queue consumption", async () => {
  const h = harness(); h.setCommitMode("after")
  assert.equal((await h.run()).pending, true)
  h.records.delete(h.queues()[0])
  assert.equal((await h.run()).success, true)
  assert.equal(h.commits, 1); assert.equal(h.queues().length, 0)
})

test("legacy Checked In is never written or queued again", async () => {
  const h = harness()
  const result = await h.run({ currentStatus: "Checked In", currentCheckInTime: "legacy-time" })
  assert.equal(result.success, true); assert.equal(result.alreadyCheckedIn, true)
  assert.equal(result.data.checkInTime, "legacy-time")
  assert.equal(h.sheetWrites, 0); assert.equal(h.commits, 0); assert.equal(h.records.size, 0)
})

test("operation is bound to the original room and schedule", async () => {
  const h = harness(); await h.run()
  assert.equal((await h.run({ roomNumber: "B122" })).conflict, true)
  assert.equal((await h.run({ checkInDate: "26.09.10/15:00" })).conflict, true)
  assert.equal(h.sheetWrites, 1); assert.equal(h.commits, 1)
})

test("a conflicting operation winning between first read and transaction cannot leak another room's result", async () => {
  const record = { state: "complete", property: "property3", roomNumber: "B122", checkInDate: "26.09.09/15:00", data: { password: "other-room" } }
  const { completeReservationCheckIn } = load("../lib/check-in-operation.ts", { crypto,
    "@/lib/firebase-admin": { getDB: () => ({ ref: () => ({
      once: async () => ({ val: () => null }),
      transaction: async () => ({ committed: false, snapshot: { val: () => record } }),
    }) }) },
  })
  const result = await completeReservationCheckIn({ ...harness().base, currentStatus: "", currentCheckInTime: "" })
  assert.equal(result.conflict, true); assert.equal(result.data, undefined)
})

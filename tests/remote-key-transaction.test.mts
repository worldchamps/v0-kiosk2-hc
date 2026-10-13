import assert from "node:assert/strict"
import test from "node:test"
import { createServer } from "node:http"
import { readFileSync } from "node:fs"
import { generateKeyPairSync, randomUUID, sign } from "node:crypto"
import vm from "node:vm"
import ts from "typescript"
import { WebSocketServer } from "ws"
import { initializeApp, deleteApp } from "firebase-admin/app"
import { getDatabase } from "firebase-admin/database"
import { verifyRequest } from "../electron/pms-card-request.js"
import * as firebaseTransaction from "../lib/firebase-transaction.ts"

test("remote-key route with real Firebase SDK and an empty cache: claim, printing, complete and fail use server state", { timeout: 15000 }, async t => {
  // Only loopback transport and synthetic signed jobs; no live database or device.
  const server = createServer(), sockets = new WebSocketServer({ server })
  const records = new Map<string, any>(), writes: string[] = []
  let now = Date.now()
  class Clock extends Date { static now() { return now } }
  let rejectNextWrite = false, removeDuringRoomRead = false, expireDuringRoomRead = false
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as { port: number }).port
  sockets.on("connection", socket => {
    socket.send(JSON.stringify({ t: "c", d: { t: "h", d: { ts: Date.now(), v: "5", h: `127.0.0.1:${port}`, s: "qa" } } }))
    socket.on("message", bytes => {
      const message = JSON.parse(bytes.toString())
      if (message.t !== "d") return
      const { r, a, b } = message.d, path = String(b.p || "").replace(/^\//, "")
      const reply = (status: string, data: unknown = null) => socket.send(JSON.stringify({ t: "d", d: { r, b: { s: status, d: data } } }))
      if (a === "q") socket.send(JSON.stringify({ t: "d", d: { a: "d", b: { p: b.p, d: records.get(path) ?? null } } }))
      if (a === "p") {
        assert.match(path, /^kiosk_key_jobs\/property1\/[a-f0-9-]{36}$/)
        assert.equal(typeof b.h, "string", "all writes must be Firebase compare-and-set transactions")
        if (rejectNextWrite) {
          rejectNextWrite = false
          const current = { ...records.get(path), status: "completed" }
          records.set(path, current)
          socket.send(JSON.stringify({ t: "d", d: { a: "d", b: { p: b.p, d: current } } }))
          reply("datastale", current)
          return
        }
        records.set(path, b.d); writes.push(path)
        socket.send(JSON.stringify({ t: "d", d: { a: "d", b: { p: b.p, d: b.d } } }))
      }
      assert.notEqual(a, "m", "the route must not bypass transactions with update")
      reply("ok")
    })
  })
  const app = initializeApp({ projectId: "demo-remote-key", databaseURL: `http://127.0.0.1:${port}?ns=demo-remote-key`,
    credential: { getAccessToken: async () => ({ access_token: "owner", expires_in: 3600 }) },
  }, "qa-remote-key-" + port)
  t.after(async () => {
    await deleteApp(app)
    for (const socket of sockets.clients) socket.terminate()
    sockets.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
  const database = getDatabase(app)
  database.useEmulator("127.0.0.1", port)
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } })
  const env = { KIOSK_PROPERTY_ID: "property1", KIOSK_DEVICE_ID: "property1-kiosk-01", CARD_DISPENSER_ENABLED: "true" }
  const pathFor = (id: string) => `kiosk_key_jobs/property1/${id}`
  const newJob = () => {
    const request = { id: randomUUID(), room: "C201", property: env.KIOSK_PROPERTY_ID, deviceId: env.KIOSK_DEVICE_ID,
      createdAt: now, expiresAt: now + 600000 }
    request.expiresAt = request.createdAt + 600000
    const signature = sign("sha256", Buffer.from("pms-card-v1:" + JSON.stringify(request)), keys.privateKey).toString("base64")
    records.set(pathFor(request.id), { request: Object.fromEntries(Object.entries(request).sort()), signature, status: "pending" })
    return request.id
  }
  const dependencies: Record<string, any> = {
    "next/server": { NextResponse: Response },
    "@/lib/firebase-admin": { getDB: () => database },
    "@/lib/firebase-transaction": firebaseTransaction,
    "@/lib/kiosk-scope": { getKioskScope: () => ({ property: "property1" }) },
    "@/electron/pms-card-request": { verifyRequest: (job: any, config: any) => verifyRequest(job, config, now, keys.publicKey) },
    "@/lib/firebase-beach-rooms": { getRoomInfoByMatchingNumber: async () => {
      if (removeDuringRoomRead) records.clear()
      if (expireDuringRoomRead) now += 600000
      return { floor: "2F", password: "synthetic" }
    } },
  }
  const exports: Record<string, any> = {}
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/remote-key/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, process: { env }, Date: Clock, require(name: string) {
    assert.ok(name in dependencies, name); return dependencies[name]
  } })
  const post = (id: string, action: string, details = {}) => exports.POST({ json: async () => ({ id, action, ...details }) })
  const id = newJob(), ref = database.ref(pathFor(id))
  await ref.once("value")
  let bareValue: unknown = "not-called"
  assert.equal((await ref.transaction(current => { bareValue = current; return undefined })).committed, false)
  assert.equal(bareValue, null, "the old claim would abort with an empty cache")
  const claim = await post(id, "claim")
  assert.equal(claim.status, 200)
  assert.equal((await claim.json()).receipt.roomNumber, "C201")
  assert.equal(records.get(pathFor(id)).status, "processing")
  assert.ok(records.get(pathFor(id)).startedAt)
  assert.equal((await post(id, "printing")).status, 200)
  assert.equal(records.get(pathFor(id)).cardIssued, true)
  assert.equal((await post(id, "printing")).status, 409)
  assert.equal((await post(id, "complete")).status, 200)
  assert.equal(records.get(pathFor(id)).status, "completed")
  const count = writes.length
  assert.equal((await post(id, "claim")).status, 409)
  assert.equal((await post(randomUUID(), "claim")).status, 400)
  assert.equal(writes.length, count, "missing and completed jobs must never be created or overwritten")

  for (const state of ["processing", "printing"]) {
    const failed = newJob()
    assert.equal((await post(failed, "claim")).status, 200)
    if (state === "printing") assert.equal((await post(failed, "printing")).status, 200)
    assert.equal((await post(failed, "fail", { error: "synthetic failure" })).status, 200)
    assert.equal(records.get(pathFor(failed)).status, "failed")
    assert.equal(records.get(pathFor(failed)).cardIssued === true, state === "printing")
  }
  const raced = newJob(), beforeRace = writes.length
  rejectNextWrite = true
  assert.equal((await post(raced, "claim")).status, 409)
  assert.equal(records.get(pathFor(raced)).status, "completed")
  assert.equal(writes.length, beforeRace, "a concurrent completion must abort the claim on server retry")

  const removed = newJob()
  removeDuringRoomRead = true
  assert.equal((await post(removed, "claim")).status, 409)
  assert.equal(records.has(pathFor(removed)), false)
  removeDuringRoomRead = false
  const expired = newJob()
  expireDuringRoomRead = true
  assert.equal((await post(expired, "claim")).status, 409)
  assert.equal(records.get(pathFor(expired)).status, "pending")
  assert.equal(writes.length, beforeRace)
})

import assert from "node:assert/strict"
import test from "node:test"
import { createServer } from "node:http"
import { WebSocketServer } from "ws"
import { initializeApp, deleteApp } from "firebase-admin/app"
import { getDatabase, type Reference } from "firebase-admin/database"
import { transactionWithReadCache } from "../lib/firebase-transaction.ts"

test("real Firebase SDK: once drops the cache; guarded transaction sees the server record", { timeout: 15000 }, async t => {
  // Loopback-only read transport, synthetic data, dummy credentials. It rejects
  // every write; no live Firebase, reservation, payment or device is contacted.
  const server = createServer()
  const sockets = new WebSocketServer({ server })
  const actions: string[] = []
  const record = { state: "saving", property: "property3", roomNumber: "A999" }
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as { port: number }).port
  sockets.on("connection", socket => {
    socket.send(JSON.stringify({ t: "c", d: { t: "h", d: { ts: Date.now(), v: "5", h: `127.0.0.1:${port}`, s: "qa" } } }))
    socket.on("message", bytes => {
      const message = JSON.parse(bytes.toString())
      if (message.t !== "d") return
      const { r, a, b } = message.d
      actions.push(a)
      if (a === "q") socket.send(JSON.stringify({ t: "d", d: { a: "d", b: { p: b.p, d: record } } }))
      socket.send(JSON.stringify({ t: "d", d: { r, b: { s: ["p", "m"].includes(a) ? "permission_denied" : "ok", d: null } } }))
    })
  })
  const app = initializeApp({ projectId: "demo-kiosk-cache", databaseURL: `http://127.0.0.1:${port}?ns=demo-kiosk-cache`,
    credential: { getAccessToken: async () => ({ access_token: "owner", expires_in: 3600 }) },
  }, "qa-cache-" + port)
  t.after(async () => {
    await deleteApp(app)
    for (const socket of sockets.clients) socket.terminate()
    sockets.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
  const database = getDatabase(app)
  database.useEmulator("127.0.0.1", port)
  const ref = database.ref("pending")
  assert.deepEqual((await ref.once("value")).val(), record)
  let bareValue: unknown = "not-called"
  await ref.transaction(current => { bareValue = current; return undefined })
  assert.equal(bareValue, null, "the old state guard would abort before reading the server")
  let guardedValue: unknown = "not-called"
  const result = await transactionWithReadCache(ref, current => { guardedValue = current; return undefined })
  assert.deepEqual(guardedValue, record)
  assert.equal(result.committed, false)
  assert.deepEqual(result.snapshot.val(), record)
  assert.ok(!actions.some(action => ["p", "m"].includes(action)), "read-only probe must not write")
})

for (const failure of ["none", "read", "transaction"]) {
  test(`read cache listener is removed after ${failure}, without removing other observers`, async () => {
    const other = () => {}
    const listeners = new Set([other])
    let called = false
    const ref = {
      on: (_event: string, listener: () => void) => listeners.add(listener),
      off: (_event: string, listener: () => void) => listeners.delete(listener),
      once: async () => { if (failure === "read") throw new Error("read failed") },
      transaction: async (update: (current: unknown) => unknown) => {
        called = true
        assert.equal(listeners.size, 2)
        if (failure === "transaction") throw new Error("transaction failed")
        // The server changed after the read. Only the transaction's current
        // value may be used; the helper must not write a stale saving record.
        assert.equal(update({ state: "complete" }), undefined)
        return { committed: false }
      },
    } as unknown as Reference
    const operation = transactionWithReadCache(ref, current => current?.state === "saving" ? { ...current, state: "committing" } : undefined)
    if (failure === "none") assert.equal((await operation).committed, false)
    else await assert.rejects(operation, new RegExp(failure + " failed"))
    assert.equal(called, failure !== "read")
    assert.deepEqual([...listeners], [other])
  })
}

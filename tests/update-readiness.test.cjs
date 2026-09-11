const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { safeToInstall } = require("../electron/update-protocol")

// Execute the actual native readiness/prepare code with fake IPC and devices.
// No Electron window, socket, payment, printer or installer is started.
function harness() {
  let now = 100000, acknowledge = true, duringPrepare = () => {}
  const events = new Map(), handles = new Map(), sent = []
  const context = {
    global: {}, config: { property: "property3" }, process: { env: {} },
    Date: { now: () => now }, safeToInstall: status => safeToInstall(status, now), URL, require,
    setTimeout: callback => setTimeout(callback, 5), clearTimeout,
    ipcMain: { on: (name, callback) => events.set(name, callback), handle: (name, callback) => handles.set(name, callback) },
    hardwareBridge: { isConnected: true }, hardwareServerProcess: {},
    tossFrontBridge: { configured: true, authenticated: false, pending: new Map() },
  }
  const native = fs.readFileSync(path.join(__dirname, "../electron/main.js"), "utf8")
  vm.runInNewContext(native.slice(native.indexOf("global.kioskHardwareReady ="), native.indexOf("global.shutdownKiosk =")), context)
  const bootstrap = fs.readFileSync(path.join(__dirname, "../electron/bootstrap.js"), "utf8")
  const start = bootstrap.indexOf("    let heartbeat =")
  const end = bootstrap.indexOf('    require("./main")', start)
  assert(start > 0 && end > start)
  vm.runInNewContext(bootstrap.slice(start, end) + "\nglobal.probe = { prepare, resume }", context)
  const frame = { url: "http://localhost:3000/kiosk/A" }
  const renderer = { mainFrame: frame, isDestroyed: () => false, send(name, nonce) {
    sent.push(name)
    if (name === "kiosk:update-prepare") {
      duringPrepare()
      if (acknowledge) events.get("kiosk:update-ready")({ senderFrame: frame, sender: renderer }, nonce)
    }
  } }
  const heartbeat = (status = {}, senderFrame = frame) => events.get("kiosk:update-heartbeat")(
    { senderFrame, sender: renderer }, { safe: true, lastActivity: now - 70000, ...status })
  now += 11000
  heartbeat()
  return { context, renderer, sent, handles, heartbeat, prepare: context.global.probe.prepare,
    tick: ms => { now += ms }, acknowledge: value => { acknowledge = value }, duringPrepare: value => { duringPrepare = value } }
}

test("idle kiosk can prepare an update when configured Toss Front is disconnected or unauthenticated", async () => {
  const h = harness()
  assert.equal(h.context.global.kioskHardwareReady(), true)
  assert.equal(await h.prepare(), true)
  assert.equal(h.context.global.kioskMaintenance, true)
})

test("pending terminal work, disconnected hardware and missing owned process still prevent installation", async () => {
  for (const block of [h => h.context.tossFrontBridge.pending.set("synthetic-request", {}),
    h => { h.context.hardwareBridge.isConnected = false }, h => { h.context.hardwareServerProcess = null }]) {
    const h = harness(); block(h)
    assert.equal(h.context.global.kioskHardwareReady(), false)
    assert.notEqual(await h.prepare(), true)
    assert.equal(h.sent.length, 0)
    assert.notEqual(h.context.global.kioskMaintenance, true)
  }
})

test("unsafe, stale, recently touched and busy HTTP states return reasons without requesting maintenance", async () => {
  for (const [block, reason] of [
    [h => h.heartbeat({ safe: false }), /미확정/],
    [h => h.tick(10001), /화면 응답/],
    [h => h.heartbeat({ lastActivity: 110000 }), /60초/],
    [h => { h.context.global.kioskHttpActive = 1 }, /예약·화면/],
    [h => { h.renderer.isDestroyed = () => true }, /화면 응답/],
  ]) {
    const h = harness(); block(h)
    assert.match(await h.prepare(), reason)
    assert.equal(h.sent.length, 0)
  }
})

test("foreign frames cannot replace an unsafe main-frame report", async () => {
  const h = harness()
  h.heartbeat({ safe: false })
  h.heartbeat({ safe: true }, { url: "http://localhost:3000/kiosk/A" })
  h.heartbeat({ safe: true }, { url: "https://example.test/" })
  assert.match(await h.prepare(), /미확정/)
})

test("active IPC and its cooldown still block installation; maintenance rejects new IPC", async () => {
  const h = harness()
  let done
  h.context.ipcMain.handle("synthetic-payment", () => new Promise(resolve => { done = resolve }))
  const pending = h.handles.get("synthetic-payment")({})
  assert.match(await h.prepare(), /장비 요청/)
  done(); await pending
  assert.match(await h.prepare(), /10초/)
  h.tick(10001); h.heartbeat()
  assert.equal(await h.prepare(), true)
  await assert.rejects(h.handles.get("synthetic-payment")({}), /업데이트 중/)
})

test("missing renderer acknowledgement resumes without installation", async () => {
  const h = harness(); h.acknowledge(false)
  assert.match(await h.prepare(), /전환 확인 응답/)
  assert.equal(h.context.global.kioskMaintenance, false)
  assert.equal(h.sent.at(-1), "kiosk:update-resume")
})

test("activity, pending terminal work or HTTP starting during the handshake cancels maintenance", async () => {
  for (const change of [h => h.heartbeat({ safe: false }),
    h => h.context.tossFrontBridge.pending.set("synthetic-request", {}),
    h => { h.context.global.kioskHttpActive = 1 }]) {
    const h = harness(); h.duringPrepare(() => change(h))
    assert.equal(typeof await h.prepare(), "string")
    assert.equal(h.context.global.kioskMaintenance, false)
    assert.equal(h.sent.at(-1), "kiosk:update-resume")
  }
})

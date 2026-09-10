const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const vm = require("node:vm")
const { createRequire } = require("node:module")
const { EventEmitter } = require("node:events")
const sourceFile = path.resolve(__dirname, "../electron/device-setup.js")
const nativeRequire = createRequire(sourceFile)
const cloud = require("../electron/update-cloud.json")

function harness(t, { arch = "x64", stored = null, registration = {}, env = "KIOSK_PROPERTY_ID=property3\nKIOSK_BUILDING=B", pairError = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kiosk-qa-setup-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const configPath = path.join(dir, "registration.json"), envPath = path.join(dir, "pc.env")
  fs.writeFileSync(configPath, JSON.stringify({ projectId: cloud.projectId, deviceId: "qa-setup-device", property: "property3", code: "b".repeat(32), arch, ...registration }))
  fs.writeFileSync(envPath, env)
  let config = stored, win, pairs = 0, writes = 0, dialogs = 0
  const handlers = new Map()
  class Window extends EventEmitter {
    constructor(options) {
      super(); win = this; this.options = options
      this.webContents = new EventEmitter()
      this.webContents.setWindowOpenHandler = handler => { this.popup = handler }
    }
    loadURL(url) { this.url = url }
    close() { this.emit("closed") }
  }
  const files = { read: () => config, write: value => { config = structuredClone(value); writes++ } }
  const module = { exports: {} }
  const context = { module, exports: module.exports, __dirname: path.dirname(sourceFile), process: { arch },
    require: name => name === "./firebase-updates" ? {
      createDeviceConnection: () => ({ pair: async () => { pairs++; if (pairError) throw pairError } }),
    } : nativeRequire(name),
  }
  vm.runInNewContext(fs.readFileSync(sourceFile, "utf8"), context, { filename: sourceFile })
  const completion = module.exports.ensureDevice({ app: {}, BrowserWindow: Window,
    ipcMain: { handle: (key, fn) => handlers.set(key, fn), removeHandler: key => handlers.delete(key) },
    dialog: { showOpenDialog: async () => ({ filePaths: [dialogs++ % 2 === 0 ? configPath : envPath], canceled: false }) }, files,
  })
  completion.catch(() => {})
  t.after(() => { if (handlers.size) win.close() })
  return { completion, files, dir, api: module.exports,
    submit: (event, restart) => handlers.get("kiosk:setup")(event || { sender: win.webContents, senderFrame: { url: win.url } }, restart),
    get snapshot() { return { config, pairs, writes, dialogs, win } },
  }
}

test("first registration validates scope and stores config only through the provided encrypted store", async t => {
  const h = harness(t)
  assert.equal((await h.submit()).ok, true)
  const config = await h.completion
  assert.equal(config.registered, true)
  assert.equal(config.arch, "x64")
  assert.equal(config.env.KIOSK_BUILDING, "B")
  assert.equal(config.code, undefined)
  assert.equal(h.snapshot.pairs, 1)
  assert.equal(h.snapshot.win.options.webPreferences.contextIsolation, true)
  assert.equal(h.snapshot.win.popup().action, "deny")
})

test("a stored registration resumes without opening files or claiming again", async t => {
  const h = harness(t, { stored: { deviceId: "qa-setup-device", registered: true, arch: "x64" } })
  assert.equal((await h.completion).registered, true)
  assert.equal(h.snapshot.dialogs, 0)
  assert.equal(h.snapshot.pairs, 0)
})

test("both setup and stored settings refuse the opposite architecture", async t => {
  for (const arch of ["x64", "ia32"]) {
    const other = arch === "x64" ? "ia32" : "x64"
    const h = harness(t, { arch, registration: { arch: other } })
    assert.match((await h.submit()).error, /비트수/)
    assert.equal(h.snapshot.writes, 0)
    assert.equal(h.snapshot.pairs, 0)
    const saved = harness(t, { arch, stored: { deviceId: "qa-setup-device", registered: true, arch: other } })
    await assert.rejects(saved.completion, /비트수/)
  }
})

test("malformed registration, mismatched property and missing building cause no pairing", async t => {
  for (const options of [
    { registration: { code: "bad" } },
    { registration: { projectId: "not-the-update-project" } },
    { env: "KIOSK_PROPERTY_ID=property2" },
    { env: "KIOSK_PROPERTY_ID=property3" },
  ]) {
    const h = harness(t, options)
    assert.ok((await h.submit()).error)
    assert.equal(h.snapshot.pairs, 0)
    assert.equal(h.snapshot.writes, 0)
  }
})

test("Windows case-insensitive execution-control variables cannot be imported", async t => {
  for (const key of ["NODE_OPTIONS", "node_options", "PaTh", "nOdE_pAtH", "electron_run_as_node", "kiosk_update_public_key_file"]) {
    const h = harness(t, { env: `KIOSK_PROPERTY_ID=property3\nKIOSK_BUILDING=B\n${key}=qa-blocked` })
    assert.match((await h.submit()).error || "", /실행기 제어/)
    assert.equal(h.snapshot.pairs, 0)
    assert.equal(h.snapshot.writes, 0)
  }
})

test("foreign windows and navigation cannot invoke registration", async t => {
  const h = harness(t)
  for (const event of [
    { sender: {}, senderFrame: { url: h.snapshot.win.url } },
    { sender: h.snapshot.win.webContents, senderFrame: { url: "https://example.test" } },
  ]) assert.ok((await h.submit(event)).error)
  assert.equal(h.snapshot.dialogs, 0)
})

test("failed pairing preserves imported config and cannot claim registration success", async t => {
  const h = harness(t, { pairError: new Error("synthetic offline") })
  assert.match((await h.submit()).error, /offline/)
  assert.equal(h.snapshot.config.registered, undefined)
  assert.equal(h.snapshot.config.code, "b".repeat(32))
  assert.match((await h.submit()).error, /offline/)
  assert.equal(h.snapshot.dialogs, 2)
  assert.equal(h.snapshot.pairs, 2)
})

test("device settings encryption failures preserve the existing synthetic data", async t => {
  const h = harness(t)
  let available = true
  const files = h.api.deviceFiles({ getPath: name => { assert.equal(name, "userData"); return h.dir } }, {
    isEncryptionAvailable: () => available,
    encryptString: text => Buffer.from("fake-encrypted:" + text),
    decryptString: bytes => bytes.toString().slice("fake-encrypted:".length),
  })
  assert.equal(files.read(), null)
  files.write({ auth: { uid: "qa-only" } })
  assert.equal(files.read().auth.uid, "qa-only")
  available = false
  assert.throws(() => files.write({ overwritten: true }), /암호화/)
  assert.throws(() => files.read(), /복호화/)
  available = true
  assert.equal(files.read().auth.uid, "qa-only")
})

const test = require("node:test")
const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { APP_ID, digest, sign, verify, releaseOf, requestOf, newer, safeToInstall, httpsBase } = require("../electron/update-protocol")
const { createKioskUpdater } = require("../electron/kiosk-updater")
const keys = crypto.generateKeyPairSync("ed25519")
const device = "kiosk-test-01", token = "a".repeat(64)
const installer = Buffer.from("mock installer; never executed")
const release = { appId: APP_ID, version: "1.2.0", arch: "x64", platform: "win32", size: installer.length,
  sha512: crypto.createHash("sha512").update(installer).digest("base64"), createdAt: Date.now() }
const command = () => ({ appId: APP_ID, action: "install", deviceId: device, id: crypto.randomUUID(),
  version: "1.2.0", fromVersion: "1.1.0", createdAt: Date.now(), expiresAt: Date.now() + 100000 })
test("signed requests are device-specific, expiring, and tamper-resistant", () => {
  const request = command(), signed = sign(request, keys.privateKey)
  assert.deepEqual(verify(signed, keys.publicKey), request)
  assert.throws(() => requestOf(signed, keys.publicKey, "another-device"))
  assert.throws(() => requestOf(signed, keys.publicKey, device, request.expiresAt))
  assert.throws(() => verify({ ...signed, payload: Buffer.from(JSON.stringify({ ...request, version: "9.0.0" })).toString("base64") }, keys.publicKey))
  assert.throws(() => releaseOf(sign({ ...release, platform: "linux" }, keys.privateKey), keys.publicKey))
  assert.throws(() => httpsBase("http://example.com"))
  assert.throws(() => httpsBase("https://user:secret@example.com"))
  assert.equal(newer("1.10.0", "1.2.0"), true)
  assert.equal(newer("1.1.0", "1.2.0"), false)
})
test("installation requires a fresh idle report and 60 seconds without guest input", () => {
  const now = 100000
  assert.equal(safeToInstall({ safe: true, at: now, lastActivity: now - 60000 }, now), true)
  for (const status of [{}, { safe: false, at: now, lastActivity: 0 }, { safe: true, at: 0, lastActivity: 0 },
    { safe: true, at: now, lastActivity: now - 59999 }]) assert.equal(safeToInstall(status, now), false)
})
function updaterHarness(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kiosk-update-test-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const stateFile = path.join(dir, "state.json")
  const request = command()
  const remote = { request: sign(request, keys.privateKey), release: sign(release, keys.privateKey) }
  const calls = { downloads: 0, installs: 0, shutdowns: 0, resumes: 0, reports: [] }
  let safe = false
  const native = { on() {}, async checkForUpdates() { return { updateInfo: { version: release.version, files: [release] } } },
    async downloadUpdate() { calls.downloads++ }, quitAndInstall() { calls.installs++ } }
  const options = {
    deviceId: device,
    publicKey: keys.publicKey, version: "1.1.0", stateFile,
    pollStatus: async (body) => { calls.reports.push(body); return remote },
    createUpdater: () => native, prepare: async () => safe, resume: () => calls.resumes++,
    shutdown: async () => calls.shutdowns++, ready: () => true,
    ...overrides,
  }
  return { client: createKioskUpdater(options), options, calls, native, remote, request, stateFile, idle: () => { safe = true } }
}
test("publishing alone cannot update; signed request downloads but busy kiosk does not restart", async (t) => {
  const h = updaterHarness(t)
  const pending = h.remote.request
  h.remote.request = null
  await h.client.tick()
  assert.equal(h.calls.downloads, 0)
  h.remote.request = pending
  await h.client.tick()
  assert.equal(h.calls.downloads, 1)
  assert.equal(h.calls.installs, 0)
  assert.equal(h.native.autoInstallOnAppQuit, false)
  assert.equal(h.client.status().state, "waiting-idle")
  h.idle()
  await h.client.tick()
  await h.client.tick()
  assert.equal(h.calls.downloads, 1)
  assert.equal(h.calls.installs, 1)
  assert.equal(h.calls.shutdowns, 1)
})
test("reboot reports success only for target version and a healthy renderer", async (t) => {
  const h = updaterHarness(t)
  h.idle()
  await h.client.tick()
  let ready = false
  const reboot = createKioskUpdater({ ...h.options, version: "1.2.0", ready: () => ready })
  await reboot.tick()
  assert.equal(reboot.status().state, "installing")
  ready = true
  await reboot.tick()
  assert.equal(reboot.status().state, "completed")
  assert.equal(h.calls.installs, 1)
})
test("an unsuccessful installer is not retried forever", async (t) => {
  const h = updaterHarness(t)
  h.idle()
  await h.client.tick()
  const reboot = createKioskUpdater(h.options)
  await reboot.tick()
  assert.equal(reboot.status().state, "failed")
  assert.equal(h.calls.installs, 1)
})
test("an asynchronous installer launch failure is reported and restarts the old app", async (t) => {
  let recoveries = 0, reportError
  const h = updaterHarness(t, { recover: () => recoveries++ })
  h.native.on = (_event, listener) => { reportError = listener }
  h.native.quitAndInstall = () => { reportError(new Error("Installer spawn failed")) }
  h.idle()
  await h.client.tick()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(h.client.status().state, "failed")
  assert.equal(h.calls.resumes, 1)
  assert.equal(recoveries, 1)
})
test("a canceled request cannot apply a previously downloaded installer", async (t) => {
  const h = updaterHarness(t, { prepare: async () => { h.remote.request = null; return true } })
  await h.client.tick()
  assert.equal(h.calls.installs, 0)
  assert.equal(h.calls.shutdowns, 0)
  assert.equal(h.calls.resumes, 1)
})
test("hash mismatch and downgrade/wrong source version fail before download", async (t) => {
  const h = updaterHarness(t)
  h.native.checkForUpdates = async () => ({ updateInfo: { version: "1.2.0", files: [{ ...release, sha512: "wrong" }] } })
  await h.client.tick()
  assert.equal(h.calls.downloads, 0)
  assert.equal(h.client.status().state, "failed")
  const h2 = updaterHarness(t, { version: "1.0.0" })
  await h2.client.tick()
  assert.equal(h2.calls.downloads, 0)
  assert.equal(h2.client.status().state, "failed")
  assert.equal(h2.client.status().requestId, h2.request.id)
})
test("offline polling preserves the pending request and resumes on reconnect", async (t) => {
  let offline = true
  const h = updaterHarness(t, { pollStatus: async () => { if (offline) throw new Error("offline"); return h.remote } })
  await h.client.tick()
  assert.equal(h.client.status().state, "online")
  offline = false
  await h.client.tick()
  assert.equal(h.client.status().state, "waiting-idle")
})
test("packaging excludes local secrets and includes bundled hardware and public trust", () => {
  const pkg = require("../package.json")
  assert.equal(pkg.main, "electron/bootstrap.js")
  assert.ok(pkg.build.files.includes("!.env*"))
  assert.ok(!pkg.build.files.includes(".env.local"))
  assert.equal(pkg.build.nsis.perMachine, false)
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false)
  assert.ok(pkg.build.extraResources.some((entry) => entry.to === "hardware"))
  assert.ok(pkg.build.extraResources.some((entry) => entry.to === "update-public.pem"))
})

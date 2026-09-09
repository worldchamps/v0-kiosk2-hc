const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const crypto = require("node:crypto")
const vm = require("node:vm")
const { spawnSync } = require("node:child_process")
const protocol = require("../electron/update-protocol")
const { peArchitecture, installerArchitecture } = require("../scripts/package-architecture.cjs")
const keys = crypto.generateKeyPairSync("ed25519")
const release = { appId: protocol.APP_ID, platform: "win32", arch: "x64", version: "1.3.0", size: 1,
  sha512: crypto.createHash("sha512").update("x").digest("base64") }

test("signed architecture is enforced and x64 release names remain backward compatible", () => {
  assert.equal(protocol.releaseTag("1.2.0"), "v1.2.0")
  assert.equal(protocol.releaseTag("1.3.0", "x64"), "v1.3.0")
  assert.equal(protocol.releaseTag("1.3.0", "ia32"), "v1.3.0-ia32")
  for (const arch of ["arm64", "x86", "", "../x64"]) assert.throws(() => protocol.checkArch(arch))
  for (const arch of ["x64", "ia32"]) {
    const signed = protocol.sign({ ...release, arch }, keys.privateKey)
    assert.equal(protocol.releaseOf(signed, keys.publicKey, arch).arch, arch)
    assert.throws(() => protocol.releaseOf(signed, keys.publicKey, arch === "x64" ? "ia32" : "x64"))
  }
})

test("PE inspection checks machine type and rejects invalid or unsupported binaries", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kiosk-arch-test-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, "mock.exe")
  const pe = Buffer.alloc(128)
  pe.write("MZ"); pe.writeUInt32LE(64, 60); pe.writeUInt32LE(0x4550, 64)
  for (const [machine, arch] of [[0x14c, "ia32"], [0x8664, "x64"]]) {
    pe.writeUInt16LE(machine, 68); fs.writeFileSync(file, pe)
    assert.equal(peArchitecture(file), arch)
  }
  pe.writeUInt16LE(0xaa64, 68); fs.writeFileSync(file, pe)
  assert.throws(() => peArchitecture(file))
  fs.writeFileSync(file, "invalid")
  assert.throws(() => peArchitecture(file))
})

function load(file, dependencies, processOverrides = {}) {
  const module = { exports: {} }
  const filename = path.join(__dirname, "..", file)
  const context = { module, exports: module.exports, __dirname: path.dirname(filename),
    process: { arch: "x64", platform: "win32", ...processOverrides }, Buffer, URL,
    console: { log() {}, error() {} }, require(name) {
      assert.ok(name in dependencies, "Unexpected dependency: " + name)
      return dependencies[name]
    } }
  vm.runInNewContext(fs.readFileSync(filename, "utf8") + (file.includes("kiosk-deploy") ? "\nmodule.exports = { main, releasePath };" : ""), context)
  return module.exports
}

test("embedded payload inspection extracts only app binaries and rejects mixed architectures", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kiosk-archive-test-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dir, "resources/hardware"), { recursive: true })
  const binary = arch => {
    const pe = Buffer.alloc(128)
    pe.write("MZ"); pe.writeUInt32LE(64, 60); pe.writeUInt32LE(0x4550, 64)
    pe.writeUInt16LE(arch === "x64" ? 0x8664 : 0x14c, 68)
    return pe
  }
  for (const [appArch, hardwareArch] of [["x64", "x64"], ["ia32", "ia32"], ["x64", "ia32"]]) {
    fs.writeFileSync(path.join(dir, "TheBeachStay Kiosk.exe"), binary(appArch))
    fs.writeFileSync(path.join(dir, "resources/hardware/KioskHardware.exe"), binary(hardwareArch))
    const archive = path.join(dir, appArch + "-" + hardwareArch + ".exe")
    const packed = spawnSync(require("7zip-bin").path7za,
      ["a", "-t7z", archive, "TheBeachStay Kiosk.exe", "resources/hardware/KioskHardware.exe"],
      { cwd: dir, encoding: "utf8", windowsHide: true })
    assert.equal(packed.status, 0, packed.error?.message || packed.stderr)
    if (appArch === hardwareArch) assert.equal(installerArchitecture(archive), appArch)
    else assert.throws(() => installerArchitecture(archive), /Mixed/)
  }
})

test("registration preserves legacy x64 and rejects a different saved runtime architecture", async () => {
  for (const arch of ["x64", "ia32"]) {
    const { ensureDevice } = load("electron/device-setup.js", {
      "node:fs": {}, "node:path": path, "./update-protocol": protocol,
      "./firebase-updates": {}, "./update-cloud.json": {},
    }, { arch })
    const config = { registered: true, deviceId: "kiosk-test-01", arch }
    assert.equal(await ensureDevice({ files: { read: () => config } }), config)
    await assert.rejects(ensureDevice({ files: { read: () => ({ ...config, arch: arch === "x64" ? "ia32" : "x64" }) } }), /비트수/)
    if (arch === "x64") assert.equal((await ensureDevice({ files: { read: () => ({ registered: true, deviceId: "legacy-device" }) } })).registered, true)
    else await assert.rejects(ensureDevice({ files: { read: () => ({ registered: true, deviceId: "legacy-device" }) } }), /비트수/)
  }
})

function deployHarness(action, args, initial = {}, payloadArch = "x64", failure = {}) {
  const records = new Map(Object.entries(initial)), writes = [], events = [], files = new Map()
  const store = { get: async key => {
      if (failure.database === key) throw new Error("Cloud login required")
      return { value: records.get(key), generation: "test" }
    },
    put: async (key, value) => { writes.push(key); records.set(key, value) } }
  const deps = {
    "node:fs": { readFileSync: () => keys.privateKey.export({ type: "pkcs8", format: "pem" }),
      openSync: () => "file", writeFileSync: (file, value) => files.set(file, value), closeSync() {} },
    "node:path": path, "node:crypto": crypto,
    "node:util": { parseArgs: () => ({ values: args, positionals: [action] }) },
    "node:child_process": { spawnSync: () => ({ status: 0, stdout: JSON.stringify({ productVersion: "1.3.0", productName: "TheBeachStay Kiosk" }) }) },
    "../ops/updates/admin.cjs": { loadConfig: () => ({ projectId: "test-project" }), database: () => store },
    "../ops/updates/github.cjs": {
      github: async (_repo, suffix) => {
        if (failure.githubTag && suffix.endsWith(failure.githubTag)) return { id: 123, draft: true }
        throw Object.assign(new Error("Not found"), { status: 404 })
      },
      publishInstaller: async (_config, _file, version, _key, arch) => {
        events.push("publish:" + arch)
        if (failure.upload === arch) throw new Error("Upload failed")
        return protocol.sign({ ...release, version, arch }, keys.privateKey)
      },
      downloadTicket: async () => { events.push("ticket"); return {} },
    },
    "../electron/update-protocol": protocol,
    "./package-architecture.cjs": { installerArchitecture: file => typeof payloadArch === "function" ? payloadArch(file) : payloadArch },
  }
  const api = load("scripts/kiosk-deploy.cjs", deps)
  return { ...api, records, writes, events, files }
}

test("initial setup rejects wrong registration architecture before importing settings or pairing", async () => {
  for (const arch of ["x64", "ia32"]) {
    for (const matches of [true, false]) {
      let handler, window, dialogs = 0, pairs = 0
      const writes = []
      const parsed = { projectId: "test-project", deviceId: "kiosk-test-01", property: "property3", code: "a".repeat(32),
        arch: matches ? arch : arch === "x64" ? "ia32" : "x64" }
      class BrowserWindow {
        constructor() { window = this; this.webContents = { setWindowOpenHandler() {}, on() {} } }
        on(_name, callback) { this.closed = callback }
        loadURL(url) { this.url = url }
        close() { this.closed() }
      }
      const { ensureDevice } = load("electron/device-setup.js", {
        "node:fs": { readFileSync: file => file === "registration" ? JSON.stringify(parsed) : "settings" },
        "node:path": path, "node:url": require("node:url"), "./update-protocol": protocol,
        "./update-cloud.json": { projectId: "test-project" },
        "dotenv": { parse: () => ({ KIOSK_PROPERTY_ID: "property3", KIOSK_BUILDING: "A" }) },
        "./firebase-updates": { createDeviceConnection: () => ({ pair: async () => { pairs++ } }) },
      }, { arch })
      const pending = ensureDevice({ BrowserWindow,
        ipcMain: { handle: (_name, callback) => { handler = callback }, removeHandler() {} },
        files: { read: () => null, write: config => writes.push({ ...config }) },
        dialog: { showOpenDialog: async () => ({ filePaths: [++dialogs === 1 ? "registration" : "settings"] }) },
      })
      const result = await handler({ sender: window.webContents, senderFrame: { url: window.url } })
      if (matches) {
        assert.equal(result.ok, true)
        assert.equal((await pending).arch, arch)
        assert.equal(pairs, 1)
        assert.equal(writes[0].env.KIOSK_BUILDING, "A")
      } else {
        assert.match(result.error, /비트수/)
        assert.equal(dialogs, 1)
        assert.equal(pairs, 0)
        assert.equal(writes.length, 0)
        const rejected = assert.rejects(pending, /등록/)
        window.close()
        await rejected
      }
    }
  }
})

test("publisher validates payload architecture and keeps each immutable release separate", async () => {
  const args = { file: "mock.exe", version: "1.3.0", key: "private.pem", arch: "ia32" }
  const wrong = deployHarness("publish", args)
  await assert.rejects(wrong.main(), /payload/)
  assert.equal(wrong.events.length, 0)
  assert.equal(wrong.writes.length, 0)
  const api = deployHarness("publish", args, { "releases/v1_3_0": "existing-x64" }, "ia32")
  await api.main()
  assert.equal(api.records.get("releases/v1_3_0"), "existing-x64")
  assert.equal(protocol.releaseOf(api.records.get("releases/v1_3_0-ia32"), keys.publicKey, "ia32").arch, "ia32")
  await assert.rejects(api.main(), /immutable/)
  assert.deepEqual(api.events, ["publish:ia32"])
})

test("new registration records explicit architecture without changing bindings or DB rules", async () => {
  for (const arch of ["x64", "ia32"]) {
    const api = deployHarness("register", { device: "kiosk-test-01", property: "property3", out: "test.json", arch })
    await api.main()
    assert.equal(api.records.get("registry/kiosk-test-01").arch, arch)
    assert.equal(JSON.parse(api.files.get("file")).arch, arch)
    assert.ok(api.writes.every(key => !key.startsWith("bindings/")))
  }
})

test("publish-all preflights both architectures before writes and never sends device requests", async () => {
  const args = { version: "1.3.0", key: "private.pem" }
  const detected = file => file.endsWith("-ia32.exe") ? "ia32" : "x64"
  const api = deployHarness("publish-all", args, {}, detected)
  await api.main()
  assert.deepEqual(api.events, ["publish:x64", "publish:ia32"])
  assert.deepEqual(api.writes, ["releases/v1_3_0", "releases/v1_3_0-ia32"])
  for (const arch of ["x64", "ia32"]) {
    assert.equal(protocol.releaseOf(api.records.get(api.releasePath("1.3.0", arch)), keys.publicKey, arch).version, "1.3.0")
  }
  const cases = [
    [deployHarness("publish-all", args, {}, "x64"), /payload/],
    [deployHarness("publish-all", args, {}, file => { if (detected(file) === "ia32") throw new Error("Missing ia32 file"); return "x64" }), /Missing/],
    [deployHarness("publish-all", args, { "releases/v1_3_0-ia32": "existing" }, detected), /immutable/],
    [deployHarness("publish-all", args, {}, detected, { database: "releases/v1_3_0-ia32" }), /login/],
    [deployHarness("publish-all", args, {}, detected, { githubTag: "v1.3.0-ia32" }), /already exists/],
    [deployHarness("publish-all", { ...args, arch: "ia32" }, {}, detected), /both default/],
  ]
  for (const [failed, message] of cases) {
    await assert.rejects(failed.main(), message)
    assert.deepEqual(failed.events, [])
    assert.deepEqual(failed.writes, [])
  }
  const partial = deployHarness("publish-all", args, {}, detected, { upload: "ia32" })
  await assert.rejects(partial.main(), /Release incomplete at ia32/)
  assert.deepEqual(partial.writes, ["releases/v1_3_0"])
  assert.deepEqual(partial.events, ["publish:x64", "publish:ia32"])
})

test("combined build is sequential and each target uses its own Python/SDK without publishing", () => {
  const pkg = require("../package.json")
  assert.equal(pkg.scripts["electron:build:all"], "node scripts/build-kiosk.cjs --arch x64 && node scripts/build-kiosk.cjs --arch ia32")
  assert.equal(pkg.scripts["kiosk:release"], "node scripts/kiosk-deploy.cjs publish-all")
  for (const arch of ["x64", "ia32"]) {
    const commands = []
    load("scripts/build-kiosk.cjs", {
      "node:fs": { existsSync: () => true, readdirSync: () => [], mkdirSync() {}, writeFileSync() {},
        readFileSync: () => keys.publicKey.export({ type: "spki", format: "pem" }) },
      "node:path": path, "node:crypto": crypto,
      "node:util": { parseArgs: () => ({ values: { arch } }) },
      "node:child_process": { spawnSync: (command, args) => { commands.push({ command, args }); return { status: 0, stdout: arch } } },
      "../electron/update-protocol": protocol,
      "./package-architecture.cjs": { peArchitecture: file => { assert.ok(file.includes(arch)); return arch } },
    }, { execPath: "build-node", chdir() {}, env: {
      KIOSK_UPDATE_PUBLIC_KEY_FILE: "public.pem", KIOSK_BUILD_PYTHON: "wrong-generic-python", KIOSK_BIXOLON_SDK_FILE: "wrong-generic-sdk",
      ["KIOSK_BUILD_PYTHON_" + arch.toUpperCase()]: arch + "-python.exe",
      ["KIOSK_BIXOLON_SDK_FILE_" + arch.toUpperCase()]: arch + "-sdk.dll",
    } })
    assert.equal(commands[0].command, arch + "-python.exe")
    const hardware = commands.find(c => c.args.includes("PyInstaller"))
    assert.equal(hardware.command, arch + "-python.exe")
    assert.ok(hardware.args.some(arg => arg.includes(arch + "-sdk.dll")))
    const builder = commands.find(c => c.args.includes("node_modules/electron-builder/cli.js"))
    assert.ok(builder.args.includes("--" + arch))
    assert.equal(builder.args.at(-1), "never")
    assert.deepEqual(Array.from(commands.at(-1).args), ["scripts/verify-kiosk-package.cjs", "--arch", arch])
  }
})

test("requests select registered architecture and never change an existing device's architecture", async () => {
  for (const arch of ["x64", "ia32"]) {
    const records = {
      "registry/kiosk-test-01": { kind: "kiosk", property: "property3", ...(arch === "ia32" ? { arch } : {}) },
      "bindings/kiosk-test-01": { uid: "test" },
      ["releases/" + protocol.releaseTag("1.3.0", arch).replaceAll(".", "_")]: protocol.sign({ ...release, arch }, keys.privateKey),
    }
    const args = { device: "kiosk-test-01", version: "1.3.0", "from-version": "1.2.0", key: "private.pem" }
    const api = deployHarness("request", args, records)
    await api.main()
    const sent = api.records.get("requests/kiosk-test-01")
    assert.equal(protocol.releaseOf(sent.release, keys.publicKey, arch).arch, arch)
    assert.equal(protocol.verify(sent.request, keys.publicKey).arch, arch)
    const wrong = deployHarness("request", { ...args, arch: arch === "x64" ? "ia32" : "x64" }, records)
    await assert.rejects(wrong.main(), /architecture/)
    assert.equal(wrong.writes.length, 0)
    assert.equal(wrong.events.length, 0)
  }
})

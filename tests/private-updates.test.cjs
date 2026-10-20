const test = require("node:test")
const assert = require("node:assert/strict")
const { createDeviceConnection, jsonRequest } = require("../electron/firebase-updates")
const { PrivateReleaseProvider, downloadUrl } = require("../electron/private-release-provider")
const cloud = require("../electron/update-cloud.json")
const { loadConfig } = require("../ops/updates/admin.cjs")

test("update project is separate from PMS and releases are pinned to the private repository", () => {
  assert.notEqual(cloud.projectId, "kiosk-pms")
  assert.equal(loadConfig().githubRepo, "worldchamps/kiosk-private-releases")
})
test("private download URLs must be HTTPS GitHub assets and not expired", () => {
  const command = { downloadUrl: "https://release-assets.githubusercontent.com/example?sig=private", downloadExpiresAt: Date.now() + 600000 }
  assert.equal(downloadUrl(command).hostname, "release-assets.githubusercontent.com")
  for (const url of ["http://release-assets.githubusercontent.com/file", "https://evil.test/file", "https://user:pass@release-assets.githubusercontent.com/file"]) {
    assert.throws(() => downloadUrl({ ...command, downloadUrl: url }))
  }
  assert.throws(() => downloadUrl({ ...command, downloadExpiresAt: Date.now() }))
})
test("custom updater uses only the signed file metadata, with no GitHub credentials", async () => {
  const command = { downloadUrl: "https://release-assets.githubusercontent.com/file?sig=private", downloadExpiresAt: Date.now() + 600000 }
  const release = { version: "1.2.0", size: 123, sha512: "signed-hash" }
  const provider = new PrivateReleaseProvider({ command, release }, null, { executor: {} })
  assert.deepEqual((await provider.getLatestVersion()).files, [{ url: "installer.exe", size: release.size, sha512: release.sha512 }])
  assert.equal(provider.resolveFiles()[0].url.href, command.downloadUrl)
  assert.equal(provider.fileExtraDownloadHeaders, null)
})

test("actual NSIS downloader caches extensionless GitHub assets using a safe filename", async (t) => {
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto")
  const { NsisUpdater } = require("electron-updater/out/NsisUpdater")
  const { DownloadedUpdateHelper } = require("electron-updater/out/DownloadedUpdateHelper")
  const { CancellationToken } = require("builder-util-runtime")
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kiosk-nsis-download-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const bytes = Buffer.from("synthetic NSIS download; never execute")
  const release = { version: "1.3.2", size: bytes.length, sha512: crypto.createHash("sha512").update(bytes).digest("base64") }
  const command = { downloadUrl: "https://release-assets.githubusercontent.com/github-production-release-asset/1/asset-id?sig=synthetic-secret", downloadExpiresAt: Date.now() + 600000 }
  const provider = new PrivateReleaseProvider({ command, release }, null, { executor: {} })
  const updater = new NsisUpdater(null, { version: "1.3.1" })
  updater.logger = null
  updater.autoInstallOnAppQuit = false
  updater.downloadedUpdateHelper = new DownloadedUpdateHelper(dir)
  updater.configOnDisk = { value: Promise.resolve({}) }
  let downloads = 0
  updater.httpExecutor = { async download(url, destination, options) {
    downloads++
    assert.equal(url.href, command.downloadUrl)
    assert.equal(options.sha512, release.sha512)
    assert.equal(destination, path.join(dir, "pending", "temp-installer.exe"))
    fs.writeFileSync(destination, bytes)
  } }
  const files = await updater.doDownloadUpdate({
    updateInfoAndProvider: { info: await provider.getLatestVersion(), provider },
    cancellationToken: new CancellationToken(), disableDifferentialDownload: true, disableWebInstaller: true,
  })
  assert.equal(downloads, 1)
  assert.deepEqual(files, [path.join(dir, "pending", "installer.exe")])
  assert.deepEqual(fs.readFileSync(files[0]), bytes)
  const cached = fs.readFileSync(path.join(dir, "pending", "update-info.json"), "utf8")
  assert.equal(JSON.parse(cached).fileName, "installer.exe")
  assert.ok(!cached.includes("synthetic-secret"))
  assert.equal(updater.quitAndInstallCalled, false)
})
test("device identity is persisted before first claim and refreshed without creating new users", async () => {
  const config = { projectId: cloud.projectId, deviceId: "qa-local-device", property: "property3", code: "a".repeat(32) }
  const events = []
  let binding = null, signups = 0, refreshes = 0
  const transport = async (url, options) => {
    events.push({ url, options })
    if (url.includes("accounts:signUp")) { signups++; return new Response(JSON.stringify({ localId: "uid-a", refreshToken: "refresh-a", idToken: "id-a", expiresIn: "3600" })) }
    if (url.includes("securetoken")) { refreshes++; return new Response(JSON.stringify({ user_id: "uid-a", refresh_token: "refresh-b", id_token: "id-b", expires_in: "3600" })) }
    if (url.includes("/bindings/")) {
      if (options.method === "PUT") {
        assert.ok(events.some(e => e.saved === true))
        binding = JSON.parse(options.body)
      } else if (!binding) return new Response("{}", { status: 401 })
      return new Response(JSON.stringify(binding))
    }
    return new Response("null")
  }
  await createDeviceConnection(config, () => events.push({ saved: true }), transport).pair()
  await createDeviceConnection(config, () => events.push({ saved: true }), transport).pair()
  assert.equal(signups, 1)
  assert.equal(refreshes, 1)
  assert.equal(events.filter(e => e.options?.method === "PUT").length, 1)
  assert.equal(config.auth.refreshToken, "refresh-b")
  assert.ok(events.filter(e => e.options).every(e => !e.options.headers.Authorization))
})
test("failed refresh does not silently register a new device and errors do not expose URLs", async () => {
  const config = { deviceId: "qa-local-device", auth: { uid: "a", refreshToken: "secret" } }
  let requests = 0
  const connection = createDeviceConnection(config, () => {}, async () => { requests++; return new Response("private body", { status: 401 }) })
  await assert.rejects(connection.pollStatus({ version: "1.2.0", state: "online" }), /장비 연결 요청 오류 \(401\)/)
  assert.equal(requests, 1)
  await assert.rejects(jsonRequest("https://example.test/?secret=sensitive", {}, async () => new Response("secret", { status: 403 })),
    (e) => !e.message.includes("secret") && e.status === 403)
})

test("PMS token requests and update polling share one refresh and persistence", async () => {
  const config = { deviceId: "qa-local-device", auth: { uid: "qa-uid", refreshToken: "qa-refresh" } }
  let refreshes = 0, saved = 0, release
  const pending = new Promise(resolve => { release = resolve })
  const connection = createDeviceConnection(config, async () => {
    saved++
    await pending
  }, async (url, options) => {
    if (url.includes("securetoken")) {
      refreshes++
      assert.equal(JSON.parse(options.body).refresh_token, "qa-refresh")
      return Response.json({ user_id: "qa-uid", refresh_token: "qa-new-refresh", id_token: "qa-token", expires_in: "3600" })
    }
    assert.equal(saved, 1)
    assert.equal(new URL(url).searchParams.get("auth"), "qa-token")
    return Response.json(null)
  })
  const tokens = [connection.idToken(), connection.idToken(), connection.idToken()]
  const poll = connection.pollStatus({ version: "1.3.52", state: "online" })
  assert.equal(refreshes, 1)
  release()
  assert.deepEqual(await Promise.all(tokens), ["qa-token", "qa-token", "qa-token"])
  await poll
  assert.equal(await connection.idToken(), "qa-token")
  assert.equal(refreshes, 1)
  assert.equal(saved, 1)
  assert.equal(config.auth.refreshToken, "qa-new-refresh")
})

test("concurrent failed token refresh is shared and a later call can retry", async () => {
  for (const failure of ["network", "persist"]) {
    const config = { deviceId: "qa-local-device", auth: { uid: "qa-uid", refreshToken: "qa-refresh" } }
    let attempts = 0, fail = true
    const connection = createDeviceConnection(config, () => {
      if (fail && failure === "persist") throw new Error("Synthetic persistence failure")
    }, async () => {
      attempts++
      if (fail && failure === "network") throw new Error("Synthetic network failure")
      return Response.json({ user_id: "qa-uid", refresh_token: "qa-refresh", id_token: "qa-token", expires_in: "3600" })
    })
    const results = await Promise.allSettled([connection.idToken(), connection.idToken(),
      connection.pollStatus({ version: "1.3.52", state: "online" })])
    assert.ok(results.every(result => result.status === "rejected"))
    assert.equal(attempts, 1)
    fail = false
    assert.equal(await connection.idToken(), "qa-token")
    assert.equal(attempts, 2)
  }
})

test("concurrent token calls share initial signup and renew an expiring token only once", async () => {
  const config = { deviceId: "qa-new-device" }
  let signups = 0, refreshes = 0, saved = 0
  const connection = createDeviceConnection(config, () => saved++, async url => {
    if (url.includes("accounts:signUp")) {
      signups++
      return Response.json({ localId: "qa-uid", refreshToken: "qa-refresh", idToken: "qa-short-token", expiresIn: "30" })
    }
    refreshes++
    return Response.json({ user_id: "qa-uid", refresh_token: "qa-new-refresh", id_token: "qa-token", expires_in: "3600" })
  })
  assert.deepEqual(await Promise.all([connection.idToken(), connection.idToken()]), ["qa-short-token", "qa-short-token"])
  assert.equal(signups, 1)
  assert.deepEqual(await Promise.all([connection.idToken(), connection.idToken()]), ["qa-token", "qa-token"])
  assert.equal(refreshes, 1)
  assert.equal(saved, 2)
})

test("packaged bootstrap shares one native connection before Next starts; development exposes no token", async () => {
  const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm")
  const source = fs.readFileSync(path.join(__dirname, "../electron/bootstrap.js"), "utf8")
  for (const isPackaged of [false, true]) {
    let boot, connections = 0, mainStarted = false, updaterOptions, persist
    const config = { deviceId: "qa-kiosk", property: "property1", env: { PRINTER_PORT: "old-port" } }
    let saved = { ...config, env: { PRINTER_PORT: "current-port" } }
    const connection = { idToken: async () => "qa-token", pollStatus: async () => ({ request: null }) }
    const dependencies = {
      electron: {
        app: { isPackaged, requestSingleInstanceLock: () => true,
          whenReady: () => ({ then: callback => { boot = callback(); return boot } }),
          getPath: () => "synthetic.exe", getVersion: () => "1.3.52", setLoginItemSettings() {}, on() {},
          quit: () => assert.fail("Bootstrap must not fail"),
        },
        ipcMain: { handle() {}, on() {} }, dialog: { showErrorBox: (_title, message) => assert.fail(message) },
      },
      "node:fs": { readFileSync: () => "synthetic-public-key" }, "node:path": path,
      "./device-setup": {
        deviceFiles: () => ({ read: () => saved, write: value => { saved = value }, stateFile: "synthetic-state" }),
        ensureDevice: async () => config,
      },
      "./firebase-updates": { createDeviceConnection: (settings, save) => {
        connections++
        assert.equal(settings, config)
        persist = save
        return connection
      } },
      "./private-release-provider": {}, "./update-protocol": {},
      "./kiosk-updater": { createKioskUpdater: options => { updaterOptions = options; return { tick() {} } } },
    }
    const context = { process: { env: {}, resourcesPath: "synthetic-resources" },
      setInterval: () => 1, clearInterval() {},
    }
    context.global = context
    context.require = name => {
      if (name === "./main") {
        mainStarted = true
        assert.equal(context.kioskDeviceIdToken, isPackaged ? connection.idToken : undefined)
        return {}
      }
      assert.ok(name in dependencies, "Unexpected dependency: " + name)
      return dependencies[name]
    }
    vm.runInNewContext(source, context)
    if (boot) await boot
    assert.equal(mainStarted, true)
    assert.equal(connections, isPackaged ? 1 : 0)
    if (isPackaged) {
      assert.equal(updaterOptions.pollStatus, connection.pollStatus)
      assert.equal(await context.kioskDeviceIdToken(), "qa-token")
      persist({ ...config, auth: { uid: "qa-uid", refreshToken: "qa-refresh" } })
      assert.equal(saved.env.PRINTER_PORT, "current-port")
      assert.equal(saved.auth.refreshToken, "qa-refresh")
    }
  }
})

test("device status hides asset URLs normalized into Windows paths", async () => {
  const config = { deviceId: "qa-redact-device", auth: { uid: "qa-uid", refreshToken: "synthetic-refresh" } }
  const reports = []
  const connection = createDeviceConnection(config, () => {}, async (url, options) => {
    if (url.includes("securetoken")) return new Response(JSON.stringify({ user_id: "qa-uid", refresh_token: "synthetic-refresh", id_token: "synthetic-token", expires_in: "3600" }))
    if (options.method === "PUT") reports.push(JSON.parse(options.body))
    return new Response("null")
  })
  for (const address of ["https://release-assets.githubusercontent.com/file?sig=synthetic-secret", "https:\\release-assets.githubusercontent.com\\file?sig=synthetic-secret"]) {
    await connection.pollStatus({ version: "1.3.2", state: "failed", message: "ENOENT temp-" + address })
  }
  assert.equal(reports.length, 2)
  for (const report of reports) assert.equal(report.message, "ENOENT temp-[주소 숨김]")
})

test("malformed cloud responses do not expose response bodies or credentials", async () => {
  await assert.rejects(jsonRequest("https://example.test", {}, async () => new Response("private-refresh-token")),
    error => !error.message.includes("private-refresh-token") && /응답/.test(error.message))
  await assert.rejects(jsonRequest("https://example.test", {}, async () => new Response("x".repeat(65536))), /너무 큽니다/)
})

test("pairing rejection preserves the same identity and never silently claims another device", async () => {
  const config = { projectId: cloud.projectId, deviceId: "qa-local-expired", property: "property3", code: "c".repeat(32) }
  let signups = 0, claims = 0, saved = 0
  const transport = async (url, options) => {
    if (url.includes("accounts:signUp")) {
      signups++
      return new Response(JSON.stringify({ localId: "qa-uid", refreshToken: "qa-refresh", idToken: "qa-token", expiresIn: "3600" }))
    }
    if (options.method === "PUT") claims++
    return new Response("null", { status: 403 })
  }
  const connection = createDeviceConnection(config, () => saved++, transport)
  await assert.rejects(connection.pair(), /403/)
  await assert.rejects(connection.pair(), /403/)
  assert.equal(signups, 1)
  assert.equal(saved, 1)
  assert.equal(claims, 2)
  assert.equal(config.auth.uid, "qa-uid")
})

test("the installed electron-updater rejects a corrupted cache by actual file hash", async (t) => {
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto")
  const { DownloadedUpdateHelper } = require("electron-updater/out/DownloadedUpdateHelper")
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kiosk-qa-cache-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const good = Buffer.from("synthetic installer bytes; never execute")
  const sha512 = crypto.createHash("sha512").update(good).digest("base64")
  const helper = new DownloadedUpdateHelper(dir)
  const pending = path.join(dir, "pending")
  fs.mkdirSync(pending)
  fs.writeFileSync(path.join(pending, "installer.exe"), good)
  fs.writeFileSync(path.join(pending, "update-info.json"), JSON.stringify({ fileName: "installer.exe", sha512 }))
  const info = { info: { sha512, size: good.length } }, logger = { info() {}, warn() {} }
  assert.equal(await helper.getValidCachedUpdateFile(info, logger), path.join(pending, "installer.exe"))
  fs.writeFileSync(path.join(pending, "installer.exe"), "corrupted")
  assert.equal(await helper.getValidCachedUpdateFile(info, logger), null)
  assert.equal(fs.existsSync(path.join(pending, "installer.exe")), false)
})

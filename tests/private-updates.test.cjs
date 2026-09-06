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
  assert.deepEqual((await provider.getLatestVersion()).files, [{ url: command.downloadUrl, size: release.size, sha512: release.sha512 }])
  assert.equal(provider.resolveFiles()[0].url.href, command.downloadUrl)
  assert.equal(provider.fileExtraDownloadHeaders, null)
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

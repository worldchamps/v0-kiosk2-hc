// Explicit live test ONLY in the isolated update project; no kiosk/hardware.
const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const { database, loadConfig } = require("../ops/updates/admin.cjs")
const { createDeviceConnection, jsonRequest } = require("../electron/firebase-updates")
const { privateRepo } = require("../ops/updates/github.cjs")
const { releaseOf, requestOf } = require("../electron/update-protocol")
const { spawnSync } = require("node:child_process")
const path = require("node:path")
const fs = require("node:fs")
async function main() {
  assert.ok(process.argv.includes("--run-live"), "Requires --run-live; never run as part of unit tests")
  const cloud = loadConfig(), store = database(cloud), suffix = crypto.randomBytes(6).toString("hex")
  const configs = [], owned = []
  const record = async (key, value) => { const prior = await store.get(key); await store.put(key, value, prior.generation) }
  const register = async (letter, expired = false) => {
    const config = { projectId: cloud.projectId, deviceId: "qa-" + letter + "-" + suffix, property: "property3", code: crypto.randomBytes(16).toString("hex") }
    owned.push("registry/" + config.deviceId, "pairings/" + config.code, "bindings/" + config.deviceId, "requests/" + config.deviceId, "status/" + config.deviceId)
    await record("registry/" + config.deviceId, { kind: "kiosk", property: config.property, revoked: false, code: config.code })
    await record("pairings/" + config.code, { deviceId: config.deviceId, expiresAt: Date.now() + (expired ? -1000 : 3600000) })
    configs.push(config)
    return { config, client: createDeviceConnection(config, () => {}) }
  }
  const denied = (operation) => assert.rejects(operation, e => [401, 403].includes(e.status))
  try {
    await privateRepo(cloud.githubRepo)
    const a = await register("a"), b = await register("b"), expired = await register("expired", true)
    await a.client.pair()
    await b.client.pair()
    await denied(expired.client.pair())
    const cloneConfig = { ...a.config, auth: undefined }
    configs.push(cloneConfig)
    await denied(createDeviceConnection(cloneConfig, () => {}).pair())
    await createDeviceConnection(a.config, () => {}).pair() // lost-response/reboot retry
    await denied(a.client.access("requests/" + b.config.deviceId))
    await denied(a.client.access("requests/" + a.config.deviceId, "PUT", { request: "forged" }))
    await denied(a.client.access("registry/" + a.config.deviceId))
    await denied(a.client.access("requests"))
    await assert.rejects(jsonRequest(cloud.databaseURL + "/requests/" + a.config.deviceId + ".json"), e => [401, 403].includes(e.status))
    await a.client.pollStatus({ version: "1.2.0", state: "online" })
    assert.equal((await store.get("status/" + a.config.deviceId)).value.version, "1.2.0")
    await denied(a.client.access("status/" + a.config.deviceId, "PUT", { version: "1.2.0", state: "online", lastSeen: { ".sv": "timestamp" }, token: "must-not-be-stored" }))
    const registry = (await store.get("registry/" + a.config.deviceId)).value
    await record("registry/" + a.config.deviceId, { ...registry, revoked: true })
    await denied(a.client.pollStatus({ version: "1.2.0", state: "online" }))
    console.log("PASS: anonymous denied, per-device isolation, one-time/expired registration, refresh, command-write denial, status validation, revocation.")
    const versionIndex = process.argv.indexOf("--release-version")
    if (versionIndex !== -1) {
      const version = process.argv[versionIndex + 1]
      assert.match(version, /^\d+\.\d+\.\d+$/)
      const requested = spawnSync(process.execPath, [path.join(__dirname, "kiosk-deploy.cjs"), "request",
        "--device", b.config.deviceId, "--version", version, "--from-version", "0.0.0", "--key", ".local/update-signing/private.pem"],
        { encoding: "utf8", windowsHide: true, timeout: 180000 })
      assert.equal(requested.status, 0, requested.stderr || "Test-device request failed")
      const packet = await b.client.pollStatus({ version: "0.0.0", state: "online" })
      const publicKey = fs.readFileSync(".local/update-signing/public.pem")
      const release = releaseOf(packet.release, publicKey)
      const command = requestOf(packet.request, publicKey, b.config.deviceId)
      assert.equal(command.version, version)
      assert.equal(command.version, release.version)
      assert.throws(() => requestOf(packet.request, publicKey, a.config.deviceId))
      const response = await fetch(command.downloadUrl, { redirect: "error", signal: AbortSignal.timeout(10 * 60000) })
      assert.equal(response.status, 200)
      const hash = crypto.createHash("sha512")
      let size = 0
      for await (const chunk of response.body) { size += chunk.length; hash.update(chunk) }
      assert.equal(size, release.size)
      assert.equal(hash.digest("base64"), release.sha512)
      console.log("PASS: CLI signed request delivered to its test device, private GitHub installer download and full signed checksum, no installer execution.")
    }
  } finally {
    for (const key of owned) await record(key, null)
    for (const config of configs) {
      if (!config.auth) continue
      const refreshed = await jsonRequest("https://securetoken.googleapis.com/v1/token?key=" + cloud.apiKey, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grant_type: "refresh_token", refresh_token: config.auth.refreshToken }),
      })
      await jsonRequest("https://identitytoolkit.googleapis.com/v1/accounts:delete?key=" + cloud.apiKey, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: refreshed.id_token }),
      })
    }
    console.log("Temporary QA database records and anonymous accounts removed; operational devices were not touched.")
  }
}
main().catch(error => { console.error(String(error.message).replace(/https?:\/\/\S+/g, "[URL hidden]")); process.exitCode = 1 })

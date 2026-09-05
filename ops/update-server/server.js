const http = require("node:http")
const { timingSafeEqual } = require("node:crypto")
const { ID, digest, check, releaseOf, requestOf } = require("../../electron/update-protocol")
const { cloudStore } = require("./store")

const tokenMatches = (token, hash) => {
  if (!/^[a-f0-9]{64}$/.test(token || "") || !/^[a-f0-9]{64}$/.test(hash || "")) return false
  return timingSafeEqual(Buffer.from(digest(token), "hex"), Buffer.from(hash, "hex"))
}
async function bodyOf(req) {
  let raw = ""
  for await (const part of req) { raw += part; if (raw.length > 16384) throw new Error("Request too large") }
  return JSON.parse(raw || "{}")
}
function createHandler(store, publicKey) {
  return async (req, res) => {
    const json = (status, body) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)) }
    try {
      const path = new URL(req.url, "http://internal").pathname
      if (path === "/health" && req.method === "GET") return json(200, { ok: true })
      if (path === "/pair" && req.method === "POST") {
        const body = await bodyOf(req)
        check(/^[a-f0-9]{32}$/.test(body.code || "") && /^[a-f0-9]{64}$/.test(body.token || ""), "Invalid registration")
        const pairing = await store.get(`pairings/${digest(body.code)}.json`)
        check(pairing.value && pairing.value.expiresAt > Date.now(), "Registration expired")
        const deviceKey = `devices/${pairing.value.deviceId}.json`
        const device = await store.get(deviceKey)
        check(device.value && !device.value.revoked && device.value.kind === "kiosk" && device.value.pairingHash === digest(body.code), "Invalid device")
        // A lost HTTP response can be retried with the same locally saved token.
        check(!device.value.tokenHash || tokenMatches(body.token, device.value.tokenHash), "Registration already used")
        if (!device.value.tokenHash) {
          await store.put(deviceKey, { ...device.value, tokenHash: digest(body.token), registeredAt: Date.now() }, device.generation)
        }
        return json(200, { deviceId: pairing.value.deviceId, property: device.value.property })
      }
      const deviceId = req.headers["x-kiosk-device"]
      const token = (req.headers.authorization || "").replace(/^Bearer /, "")
      if (!ID.test(deviceId || "")) return json(401, { error: "Unauthorized" })
      const device = (await store.get(`devices/${deviceId}.json`)).value
      if (!device || device.revoked || device.kind !== "kiosk" || !tokenMatches(token, device.tokenHash)) return json(401, { error: "Unauthorized" })

      const pending = (await store.get(`requests/${deviceId}.json`)).value
      let command = null
      try { if (pending) command = requestOf(pending, publicKey, deviceId) } catch { /* expired/revoked requests are not delivered */ }
      if (path === "/poll" && req.method === "POST") {
        const body = await bodyOf(req)
        check(typeof body.version === "string" && body.version.length < 40, "Invalid status")
        const key = `status/${deviceId}.json`
        const old = await store.get(key)
        await store.put(key, {
          version: body.version, state: String(body.state || "online").slice(0, 40),
          requestId: ID.test(body.requestId || "") ? body.requestId : null,
          message: String(body.message || "").slice(0, 250), lastSeen: Date.now(),
        }, old.generation)
        const release = command ? (await store.get(`releases/${command.version}.json`)).value : null
        return json(200, { request: command ? pending : null, release })
      }
      const feed = path.match(/^\/feed\/([a-zA-Z0-9_-]{8,80})\/(latest.yml|installer.exe)$/)
      if (feed && command?.id === feed[1] && req.method === "GET") {
        const signed = (await store.get(`releases/${command.version}.json`)).value
        const release = releaseOf(signed, publicKey)
        check(release.version === command.version, "Release mismatch")
        if (feed[2] === "latest.yml") {
          res.writeHead(200, { "Content-Type": "text/yaml", "Cache-Control": "no-store" })
          return res.end(`version: ${release.version}\nfiles:\n  - url: installer.exe\n    sha512: ${release.sha512}\n    size: ${release.size}\npath: installer.exe\nsha512: ${release.sha512}\nreleaseDate: '${new Date(release.createdAt).toISOString()}'\n`)
        }
        // A private object is streamed; device credentials are never redirected
        // to another host. No administrator-supplied arbitrary download URL.
        const file = store.bucket.file(`installers/${release.version}/installer.exe`)
        res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": release.size, "Cache-Control": "no-store" })
        const stream = file.createReadStream()
        res.on("close", () => stream.destroy())
        stream.on("error", () => res.destroy()).pipe(res)
        return
      }
      return json(404, { error: "Not found" })
    } catch (error) {
      if (res.headersSent) return res.destroy()
      // Never log registration codes, tokens, credential paths, or bodies.
      return json(Number(error.code) === 412 ? 409 : 400, { error: "Request rejected; retry or contact the deployment administrator." })
    }
  }
}
if (require.main === module) {
  const key = process.env.KIOSK_UPDATE_PUBLIC_KEY
  if (!key) throw new Error("KIOSK_UPDATE_PUBLIC_KEY is required")
  http.createServer(createHandler(cloudStore(), key.replace(/\\n/g, "\n"))).listen(Number(process.env.PORT || 8080))
}
module.exports = { createHandler, tokenMatches }

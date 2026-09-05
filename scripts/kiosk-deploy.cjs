#!/usr/bin/env node
// Run only on the deployment workstation. Cloud credentials and signing keys
// must NEVER be copied to a kiosk or committed to this repository.
const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")
const { parseArgs } = require("node:util")
const { spawnSync } = require("node:child_process")
const { cloudStore } = require("../ops/update-server/store")
const { APP_ID, ID, VERSION, digest, check, httpsBase, sign, releaseOf, requestOf, newer } = require("../electron/update-protocol")
const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: Object.fromEntries(["out", "key", "public-key", "server", "device", "property", "name", "file", "version", "from-version"].map((key) => [key, { type: "string" }])),
})
async function main() {
  const action = positionals[0]
  if (!action || action === "help") {
    console.log("Commands: keygen --out DIR | register --device ID --property propertyN --server HTTPS --out FILE | publish --file EXE --version X.Y.Z --key PEM | request --device ID --version X.Y.Z --from-version X.Y.Z --key PEM | status --device ID | cancel --device ID | revoke --device ID")
    return
  }
  if (action === "keygen") {
    check(args.out, "--out is required")
    fs.mkdirSync(args.out, { recursive: true })
    const keys = crypto.generateKeyPairSync("ed25519", { publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } })
    fs.writeFileSync(path.join(args.out, "private.pem"), keys.privateKey, { flag: "wx", mode: 0o600 })
    fs.writeFileSync(path.join(args.out, "public.pem"), keys.publicKey, { flag: "wx" })
    console.log("Signing key files created. Keep private.pem on the deployment workstation only.")
    return
  }
  const store = cloudStore()
  if (action === "publish") {
    check(VERSION.test(args.version || "") && args.file && args.key, "file/version/key are required")
    check(path.extname(args.file).toLowerCase() === ".exe", "Only an NSIS installer is supported")
    check(process.platform === "win32", "Publish installers from the Windows build workstation")
    const inspected = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "inspect-installer.ps1"), "-InstallerPath", path.resolve(args.file)], { encoding: "utf8", windowsHide: true })
    check(inspected.status === 0, "Unable to inspect installer version")
    const actual = JSON.parse(inspected.stdout)
    check(actual.productVersion === args.version && actual.productName === "TheBeachStay Kiosk", "Installer product/version does not match the requested release")
    const hash = crypto.createHash("sha512")
    for await (const chunk of fs.createReadStream(args.file)) hash.update(chunk)
    const payload = { appId: APP_ID, version: args.version, platform: "win32", arch: "x64", sha512: hash.digest("base64"), size: fs.statSync(args.file).size, createdAt: Date.now() }
    const signed = sign(payload, fs.readFileSync(args.key))
    check(!(await store.get(`releases/${args.version}.json`)).value, "This version is immutable; choose a new version")
    await store.bucket.upload(args.file, { destination: `installers/${args.version}/installer.exe`, preconditionOpts: { ifGenerationMatch: 0 } })
    await store.put(`releases/${args.version}.json`, signed, 0)
    console.log(`Published ${args.version}. No device update was requested.`)
    return
  }
  check(ID.test(args.device || ""), "--device must be an explicit unique kiosk ID (8-80 characters)")
  const key = `devices/${args.device}.json`, device = await store.get(key)
  if (action === "register") {
    check(/^property[1-4]$/.test(args.property || "") && args.out && args.server, "property/server/out are required")
    check(!device.value || (device.value.kind === "kiosk" && !device.value.tokenHash && !device.value.revoked && device.value.property === args.property),
      "Registered/revoked device exists; do not overwrite credentials or change property")
    const server = httpsBase(args.server), code = crypto.randomBytes(16).toString("hex")
    // Check the output target BEFORE creating any cloud state.
    const fd = fs.openSync(args.out, "wx", 0o600)
    try {
      await store.put(key, { kind: "kiosk", property: args.property, name: args.name || args.device, revoked: false, pairingHash: digest(code) }, device.generation)
      await store.put(`pairings/${digest(code)}.json`, { deviceId: args.device, expiresAt: Date.now() + 3600000 }, 0)
      fs.writeFileSync(fd, JSON.stringify({ server, code, deviceId: args.device, property: args.property }))
    } finally { fs.closeSync(fd) }
    console.log("One-hour, one-device registration file created. Transfer privately to that kiosk.")
    return
  }
  check(device.value?.kind === "kiosk", "Unknown kiosk (room-management PCs are not supported)")
  if (action === "status") {
    const status = (await store.get(`status/${args.device}.json`)).value
    console.log(JSON.stringify({ deviceId: args.device, property: device.value.property, revoked: device.value.revoked,
      online: !!status && Date.now() - status.lastSeen < 90000, status }, null, 2))
    return
  }
  if (action === "revoke") {
    await store.put(key, { ...device.value, revoked: true }, device.generation)
    console.log("Device access revoked.")
    return
  }
  const requestKey = `requests/${args.device}.json`, previous = await store.get(requestKey)
  if (action === "cancel") { await store.put(requestKey, null, previous.generation); console.log("Pending request canceled (cannot undo an installer already started)."); return }
  check(action === "request" && args.key && args.version && args["from-version"], "request requires key/version/from-version")
  check(!device.value.revoked && device.value.tokenHash, "Device is not registered or is revoked")
  const privateKey = fs.readFileSync(args.key), publicKey = crypto.createPublicKey(privateKey)
  const release = releaseOf((await store.get(`releases/${args.version}.json`)).value, publicKey)
  check(newer(release.version, args["from-version"]), "Only upgrades are allowed; recovery requires a new release version")
  if (previous.value) {
    let active = false
    try { requestOf(previous.value, publicKey, args.device); active = true } catch {}
    const status = (await store.get(`status/${args.device}.json`)).value
    check(!active || (status?.requestId === requestOf(previous.value, publicKey, args.device).id && ["completed", "failed"].includes(status.state)), "A pending request exists; inspect status or cancel it first")
  }
  const request = { appId: APP_ID, action: "install", id: crypto.randomUUID(), deviceId: args.device,
    version: release.version, fromVersion: args["from-version"], createdAt: Date.now(), expiresAt: Date.now() + 24 * 3600000 }
  await store.put(requestKey, sign(request, privateKey), previous.generation)
  console.log(JSON.stringify({ requested: request.id, deviceId: args.device, version: release.version, expiresAt: request.expiresAt }))
}
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1 })

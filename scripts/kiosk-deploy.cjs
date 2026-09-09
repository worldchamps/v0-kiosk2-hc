#!/usr/bin/env node
// Deployment workstation only. No credentials or private keys in installers.
const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")
const { parseArgs } = require("node:util")
const { spawnSync } = require("node:child_process")
const { loadConfig, database } = require("../ops/updates/admin.cjs")
const { publishInstaller, downloadTicket } = require("../ops/updates/github.cjs")
const { APP_ID, ID, VERSION, check, checkArch, releaseTag, sign, releaseOf, requestOf, newer } = require("../electron/update-protocol")
const { installerArchitecture } = require("./package-architecture.cjs")
const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: Object.fromEntries(["out", "key", "device", "property", "name", "file", "version", "from-version", "arch"].map((key) => [key, { type: "string" }])),
})
const releasePath = (version, arch) => "releases/" + releaseTag(version, arch).replaceAll(".", "_")
async function main() {
  const action = positionals[0]
  if (!action || action === "help") {
    console.log("Commands: keygen --out DIR | register --device ID --property propertyN --out FILE | publish --file EXE --version X.Y.Z --key PEM | request --device ID --version X.Y.Z --from-version X.Y.Z --key PEM | status --device ID | cancel --device ID | revoke --device ID")
    console.log("register/publish: --arch x64 (default) or ia32; request uses the registered architecture. Existing records without arch remain x64.")
    return
  }
  if (action === "keygen") {
    check(args.out, "--out is required")
    fs.mkdirSync(args.out, { recursive: true })
    const keys = crypto.generateKeyPairSync("ed25519", { publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } })
    fs.writeFileSync(path.join(args.out, "private.pem"), keys.privateKey, { flag: "wx", mode: 0o600 })
    fs.writeFileSync(path.join(args.out, "public.pem"), keys.publicKey, { flag: "wx" })
    console.log("Signing key files created; back up the private key on the deployment workstation.")
    return
  }
  const config = loadConfig(), store = database(config)
  if (action === "publish") {
    const arch = checkArch(args.arch || "x64")
    check(VERSION.test(args.version || "") && args.file && args.key, "file/version/key are required")
    check(path.extname(args.file).toLowerCase() === ".exe" && process.platform === "win32", "Publish Windows NSIS installers only")
    const inspected = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "inspect-installer.ps1"), "-InstallerPath", path.resolve(args.file)], { encoding: "utf8", windowsHide: true })
    check(inspected.status === 0, "Unable to inspect installer version")
    const actual = JSON.parse(inspected.stdout)
    check(actual.productVersion === args.version && actual.productName === "TheBeachStay Kiosk", "Installer product/version mismatch")
    check(installerArchitecture(path.resolve(args.file)) === arch, "Installer payload does not match --arch")
    const key = releasePath(args.version, arch), previous = await store.get(key)
    check(!previous.value, "This release version is immutable")
    const signed = await publishInstaller(config, args.file, args.version, fs.readFileSync(args.key), arch)
    await store.put(key, signed, previous.generation)
    console.log("Private release published: " + args.version + ". No device update requested.")
    return
  }
  check(ID.test(args.device || ""), "An explicit kiosk --device ID (8-80 characters) is required")
  const key = "registry/" + args.device, device = await store.get(key)
  if (action === "register") {
    const arch = checkArch(args.arch || "x64")
    check(/^property[1-4]$/.test(args.property || "") && args.out, "property/out are required")
    const binding = await store.get("bindings/" + args.device)
    check(!binding.value && (!device.value || (!device.value.revoked && device.value.kind === "kiosk" && device.value.property === args.property)), "Do not overwrite a registered/revoked device or reassign its property")
    check(!device.value || (device.value.arch || "x64") === arch, "Do not reassign a device's architecture")
    const code = crypto.randomBytes(16).toString("hex"), expiresAt = Date.now() + 3600000
    const fd = fs.openSync(args.out, "wx", 0o600)
    try {
      await store.put(key, { kind: "kiosk", property: args.property, arch, name: args.name || args.device, revoked: false, code }, device.generation)
      const pairing = await store.get("pairings/" + code)
      await store.put("pairings/" + code, { deviceId: args.device, expiresAt }, pairing.generation)
      fs.writeFileSync(fd, JSON.stringify({ projectId: config.projectId, code, deviceId: args.device, property: args.property, arch, expiresAt }))
    } finally { fs.closeSync(fd) }
    console.log("One-hour, one-device registration file created. Transfer privately to that kiosk.")
    return
  }
  check(device.value?.kind === "kiosk", "Unknown kiosk; room-management PCs are not supported")
  if (action === "status") {
    const status = (await store.get("status/" + args.device)).value
    const binding = (await store.get("bindings/" + args.device)).value
    console.log(JSON.stringify({ deviceId: args.device, property: device.value.property, arch: device.value.arch || "x64", registered: !!binding, revoked: device.value.revoked,
      online: !device.value.revoked && !!status && Date.now() - status.lastSeen < 180000, status }, null, 2))
    return
  }
  if (action === "revoke") {
    await store.put(key, { ...device.value, revoked: true }, device.generation)
    console.log("Device access revoked. Already downloaded installers cannot be recalled.")
    return
  }
  const requestKey = "requests/" + args.device, previous = await store.get(requestKey)
  if (action === "cancel") {
    await store.put(requestKey, null, previous.generation)
    console.log("Pending request canceled; cannot undo installation already started.")
    return
  }
  check(action === "request" && args.key && VERSION.test(args.version || "") && VERSION.test(args["from-version"] || ""), "request requires key/version/from-version")
  check(!device.value.revoked && (await store.get("bindings/" + args.device)).value, "Device is not registered or is revoked")
  const privateKey = fs.readFileSync(args.key), publicKey = crypto.createPublicKey(privateKey)
  const arch = checkArch(device.value.arch || "x64")
  check(!args.arch || args.arch === arch, "Requested architecture does not match the registered kiosk")
  const signedRelease = (await store.get(releasePath(args.version, arch))).value
  const release = releaseOf(signedRelease, publicKey, arch)
  check(newer(release.version, args["from-version"]), "Only upgrades are allowed")
  if (previous.value?.request) {
    let active
    try { active = requestOf(previous.value.request, publicKey, args.device) } catch {}
    const status = (await store.get("status/" + args.device)).value
    check(!active || (status?.requestId === active.id && ["completed", "failed"].includes(status.state)), "A pending request exists; inspect/cancel before replacing it")
  }
  const ticket = await downloadTicket(config, release)
  const request = { appId: APP_ID, action: "install", id: crypto.randomUUID(), deviceId: args.device,
    version: release.version, arch, fromVersion: args["from-version"], createdAt: Date.now(), expiresAt: Date.now() + 24 * 3600000, ...ticket }
  await store.put(requestKey, { request: sign(request, privateKey), release: signedRelease }, previous.generation)
  console.log(JSON.stringify({ requested: request.id, deviceId: args.device, version: release.version,
    downloadExpiresAt: request.downloadExpiresAt, expiresAt: request.expiresAt }))
}
if (require.main === module) main().catch((error) => {
  console.error(String(error.message).replace(/https?:\/\/\S+/g, "[URL hidden]")); process.exitCode = 1
})

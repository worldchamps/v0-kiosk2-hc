const fs = require("node:fs")
const path = require("node:path")
const assert = require("node:assert/strict")
const { spawnSync } = require("node:child_process")
const { parseArgs } = require("node:util")
const { checkArch } = require("../electron/update-protocol")
const { peArchitecture, installerArchitecture } = require("./package-architecture.cjs")
const { values } = parseArgs({ options: { arch: { type: "string", default: "x64" } } })
const arch = checkArch(values.arch)
const resources = path.resolve(__dirname, `../dist/${arch}/${arch === "x64" ? "win-unpacked" : "win-ia32-unpacked"}/resources`)
const appDir = path.join(resources, "app")
const pkg = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8"))
assert.equal(pkg.main, "electron/bootstrap.js")
assert.equal(pkg.version, require("../package.json").version)
for (const name of [".env.local", ".env", ".local", "ops", "scripts"]) assert.equal(fs.existsSync(path.join(appDir, name)), false, name)
for (const name of ["electron/bootstrap.js", "electron/setup.html", "electron/firebase-updates.js", "electron/private-release-provider.js", "electron/update-cloud.json", ".next/BUILD_ID", "next.config.mjs"]) assert.ok(fs.existsSync(path.join(appDir, name)), name)
assert.equal(require(path.join(appDir, "electron/update-cloud.json")).projectId, "beachstay-kiosk-updates")
function inspectSecrets(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue
    const file = path.join(dir, entry.name)
    assert.ok(!entry.name.startsWith(".env") && entry.name !== "kiosk-device.bin", "Local configuration must not be packaged")
    if (entry.isDirectory()) inspectSecrets(file)
    else if (/\.(js|json|html|pem|txt)$/.test(entry.name)) {
      const text = fs.readFileSync(file, "utf8")
      assert.doesNotMatch(text, /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC )?PRIVATE KEY-----/)
      assert.doesNotMatch(text, /(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/)
    }
  }
}
inspectSecrets(appDir)
assert.ok(fs.existsSync(path.join(resources, "app-update.yml")))
const key = fs.readFileSync(path.join(resources, "update-public.pem"), "utf8")
assert.match(key, /BEGIN PUBLIC KEY/)
assert.doesNotMatch(key, /PRIVATE KEY/)
const hardwareExe = path.join(resources, "hardware/KioskHardware.exe")
const kioskExe = path.resolve(resources, "../TheBeachStay Kiosk.exe")
assert.equal(peArchitecture(hardwareExe), arch, "Hardware payload architecture")
assert.equal(peArchitecture(kioskExe), arch, "Electron payload architecture")
const installer = path.resolve(__dirname, `../dist/${arch}/TheBeachStay Kiosk Setup ${pkg.version}-${arch}.exe`)
assert.equal(installerArchitecture(installer), arch, "NSIS payload architecture")
const run = (command, args, env) => {
  const result = spawnSync(command, args, { env, encoding: "utf8", windowsHide: true, timeout: 120000 })
  if (result.status !== 0) throw new Error(result.error?.message || result.stderr || "Packaged runtime verification failed")
  console.log(result.stdout.trim())
}
run(hardwareExe, ["--self-test"])
run(kioskExe, ["-e",
  "require('node:assert/strict').equal(process.arch,process.argv[2]); for (const name of ['next','serialport','electron-updater','firebase-admin','googleapis']) require(require.resolve(name,{paths:[process.argv[1]]})); console.log('Packaged '+process.arch+' Node/native dependencies OK (no device connection)')",
  appDir, arch], { ...process.env, ELECTRON_RUN_AS_NODE: "1" })
// Start only the packaged web server on a temporary loopback port. This route
// reads local A/B configuration, not reservations, cloud state, or hardware.
run(kioskExe, ["-e", `
  const assert = require('node:assert/strict');
  process.chdir(process.argv[1]);
  const next = require(require.resolve('next', { paths: [process.argv[1]] }));
  (async () => {
    const app = next({ dev: false, dir: process.argv[1], hostname: '127.0.0.1' });
    await app.prepare();
    const server = require('node:http').createServer(app.getRequestHandler());
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/kiosk-config', { signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { property: 'property3', building: 'A' });
    server.close(); await app.close();
    console.log('Packaged '+process.arch+' production web server OK (loopback only)');
    process.exit(0);
  })().catch(error => { console.error(error); process.exit(1); });
`, appDir], { ...process.env, ELECTRON_RUN_AS_NODE: "1", NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", KIOSK_PROPERTY_ID: "property3", KIOSK_BUILDING: "A" })
console.log("Installer resources verified; no cloud or kiosk hardware accessed.")

const fs = require("node:fs")
const path = require("node:path")
const assert = require("node:assert/strict")
const { spawnSync } = require("node:child_process")
const resources = path.resolve(__dirname, "../dist/win-unpacked/resources")
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
const run = (command, args, env) => {
  const result = spawnSync(command, args, { env, encoding: "utf8", windowsHide: true })
  if (result.status !== 0) throw new Error(result.error?.message || result.stderr || "Packaged runtime verification failed")
  console.log(result.stdout.trim())
}
run(path.join(resources, "hardware/KioskHardware.exe"), ["--self-test"])
run(path.resolve(resources, "../TheBeachStay Kiosk.exe"), ["-e",
  "for (const name of ['next','serialport','electron-updater','firebase-admin','googleapis']) require(require.resolve(name,{paths:[process.argv[1]]})); console.log('Packaged Node/native dependencies OK (no device connection)')",
  appDir], { ...process.env, ELECTRON_RUN_AS_NODE: "1" })
console.log("Installer resources verified; no cloud or kiosk hardware accessed.")

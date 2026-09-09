const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")
const { spawnSync } = require("node:child_process")
const root = path.resolve(__dirname, "..")
process.chdir(root)
const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: "inherit", windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`)
}
async function main() {
  if (process.platform !== "win32") throw new Error("Build the Windows installer on Windows")
  if (fs.readdirSync(root).some(name => /^\.env($|\.(local|production|development|test)(\.|$))/.test(name))) {
    throw new Error("Use a clean installer build folder without PC-specific .env files")
  }
  const keyPath = process.env.KIOSK_UPDATE_PUBLIC_KEY_FILE
  if (!keyPath) throw new Error("KIOSK_UPDATE_PUBLIC_KEY_FILE is required; never package a private key")
  const raw = fs.readFileSync(keyPath, "utf8")
  if (raw.includes("PRIVATE KEY")) throw new Error("A private signing key must not be packaged")
  const key = crypto.createPublicKey(raw)
  if (key.asymmetricKeyType !== "ed25519") throw new Error("An Ed25519 public key is required")
  fs.mkdirSync(".local", { recursive: true })
  fs.writeFileSync(".local/update-public.pem", key.export({ type: "spki", format: "pem" }))
  run(process.execPath, ["--test", "tests/kiosk-updates.test.cjs", "tests/private-updates.test.cjs"])
  run(process.execPath, ["--experimental-strip-types", "--test", "tests/reservation-check-in.test.mts", "tests/reservation-schedule.test.mts", "tests/kiosk-sales-config.test.mts", "tests/kiosk-building-scope.test.mts"])
  const python = path.join(root, ".local", "build-python", "Scripts", "python.exe")
  if (!fs.existsSync(python)) throw new Error("First create .local/build-python and install hardware_server/requirements-build.txt")
  run(python, ["-m", "PyInstaller", "--noconfirm", "--clean", "--onedir", "--name", "KioskHardware",
    "--distpath", ".local/hardware", "--workpath", ".local/hardware-work", "--specpath", ".local", "hardware_server/main.py"])
  run(process.execPath, ["node_modules/next/dist/bin/next", "build"])
  // Never publish from a build. The deployment tool requires a separate request.
  run(process.execPath, ["node_modules/electron-builder/cli.js", "--win", "nsis", "--x64", "--publish", "never"])
  run(process.execPath, ["scripts/verify-kiosk-package.cjs"])
}
main().catch((error) => { console.error(error.message); process.exitCode = 1 })

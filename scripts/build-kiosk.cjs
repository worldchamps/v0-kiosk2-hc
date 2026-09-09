const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")
const { spawnSync } = require("node:child_process")
const { parseArgs } = require("node:util")
const { checkArch } = require("../electron/update-protocol")
const { peArchitecture } = require("./package-architecture.cjs")
const root = path.resolve(__dirname, "..")
process.chdir(root)
const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: "inherit", windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`)
}
async function main() {
  if (process.platform !== "win32") throw new Error("Build the Windows installer on Windows")
  const { values } = parseArgs({ options: { arch: { type: "string", default: "x64" } } })
  const arch = checkArch(values.arch)
  const python = process.env[`KIOSK_BUILD_PYTHON_${arch.toUpperCase()}`] || process.env.KIOSK_BUILD_PYTHON || path.join(root, ".local", arch === "x64" ? "build-python" : "build-python-ia32", "Scripts", "python.exe")
  if (!fs.existsSync(python)) throw new Error(`Create a ${arch} Python venv and install hardware_server/requirements-build.txt; KIOSK_BUILD_PYTHON may specify its python.exe`)
  if (peArchitecture(python) !== arch) throw new Error(`Build Python must match ${arch}; do not bundle a different architecture`)
  const probe = spawnSync(python, ["-c", "import struct; print('ia32' if struct.calcsize('P') == 4 else 'x64')"], { encoding: "utf8", windowsHide: true })
  if (probe.status !== 0 || probe.stdout.trim() !== arch) throw new Error("Python runtime architecture check failed")
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
  run(process.execPath, ["--test", "tests/kiosk-updates.test.cjs", "tests/private-updates.test.cjs", "tests/kiosk-architecture.test.cjs"])
  run(process.execPath, ["--experimental-strip-types", "--test", "tests/reservation-check-in.test.mts", "tests/reservation-schedule.test.mts", "tests/kiosk-sales-config.test.mts", "tests/kiosk-building-scope.test.mts"])
  const sdk = process.env[`KIOSK_BIXOLON_SDK_FILE_${arch.toUpperCase()}`] || process.env.KIOSK_BIXOLON_SDK_FILE
  if (sdk && peArchitecture(sdk) !== arch) throw new Error("Bixolon SDK DLL architecture does not match the installer")
  // SerialPort ships N-API binaries for both Windows architectures. Rebuilding
  // ia32 with an x64 host Node tries to load the wrong architecture in its probe.
  const serialport = path.join(root, "node_modules/@serialport/bindings-cpp/prebuilds", `win32-${arch}`, "node.napi.node")
  if (peArchitecture(serialport) !== arch) throw new Error("SerialPort N-API prebuild architecture does not match the installer")
  run(python, ["-m", "PyInstaller", "--noconfirm", "--clean", "--onedir", "--name", "KioskHardware",
    "--distpath", `.local/hardware-${arch}`, "--workpath", `.local/hardware-work-${arch}`, "--specpath", ".local",
    ...(sdk ? ["--add-binary", `${path.resolve(sdk)}${path.delimiter}bin`] : []), "hardware_server/main.py"])
  run(process.execPath, ["node_modules/next/dist/bin/next", "build"])
  // Never publish from a build. The deployment tool requires a separate request.
  run(process.execPath, ["node_modules/electron-builder/cli.js", "--win", "nsis", `--${arch}`, `--config.directories.output=dist/${arch}`, "--config.npmRebuild=false", "--publish", "never"])
  run(process.execPath, ["scripts/verify-kiosk-package.cjs", "--arch", arch])
}
main().catch((error) => { console.error(error.message); process.exitCode = 1 })

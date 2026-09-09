const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const root = path.resolve(__dirname, "..")
const files = fs.readdirSync(path.join(root, "tests"))
  .filter(name => /\.test\.(cjs|mts)$/.test(name)).sort().map(name => `tests/${name}`)
if (!files.length) throw new Error("No kiosk tests found")
// Enumerate in Node, not shell globs: identical coverage in PowerShell, cmd and CI.
const result = spawnSync(process.execPath, ["--experimental-strip-types", "--test", "--test-timeout=60000", ...files], {
  cwd: root, stdio: "inherit", windowsHide: true, timeout: 180000,
})
if (result.error) console.error(result.error.message)
process.exitCode = result.status ?? 1

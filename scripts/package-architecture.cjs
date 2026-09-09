const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const { check } = require("../electron/update-protocol")

// NSIS's outer EXE is 32-bit even for x64 installers. Inspect its payload,
// and separately inspect the actual packaged Electron/Python PE headers.
function peArchitecture(file) {
  const fd = fs.openSync(file, "r")
  try {
    const dos = Buffer.alloc(64), pe = Buffer.alloc(6)
    check(fs.readSync(fd, dos, 0, dos.length, 0) === 64 && dos.toString("ascii", 0, 2) === "MZ", "Invalid PE file")
    const offset = dos.readUInt32LE(60)
    check(offset >= 64 && fs.readSync(fd, pe, 0, pe.length, offset) === 6 && pe.readUInt32LE(0) === 0x4550, "Invalid PE header")
    const arch = { 0x14c: "ia32", 0x8664: "x64" }[pe.readUInt16LE(4)]
    check(arch, "Unsupported PE architecture")
    return arch
  } finally { fs.closeSync(fd) }
}
function installerArchitecture(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kiosk-payload-inspect-"))
  try {
    // The builder's 7za reads the embedded 7z payload directly, not NSIS file
    // names. Extract only these two files; never execute the installer.
    const result = spawnSync(require("7zip-bin").path7za,
      ["e", "-y", "-o" + dir, path.resolve(file), "TheBeachStay Kiosk.exe", "resources/hardware/KioskHardware.exe"],
      { encoding: "utf8", windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 })
    check(result.status === 0, "Unable to inspect NSIS payload architecture")
    const arch = peArchitecture(path.join(dir, "TheBeachStay Kiosk.exe"))
    check(peArchitecture(path.join(dir, "KioskHardware.exe")) === arch, "Mixed Electron/hardware payload architectures")
    return arch
  } finally {
    check(path.dirname(dir) === path.resolve(os.tmpdir()), "Unsafe inspection cleanup path")
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
module.exports = { peArchitecture, installerArchitecture }

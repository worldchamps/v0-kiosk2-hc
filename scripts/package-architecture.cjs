const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const { check } = require("../electron/update-protocol")
const inspectionPrefix = "kiosk-payload-inspect-"

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
function removeInspectionDirectory(dir, folder) {
  dir = path.resolve(dir)
  check(path.dirname(dir) === path.resolve(folder) && path.basename(dir).startsWith(inspectionPrefix), "Unsafe inspection cleanup path")
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 })
  } catch (error) {
    console.warn(`Warning: Unable to remove inspection directory ${dir}: ${error.message}`)
  }
}
function cleanInspectionDirectories(folder) {
  folder = path.resolve(folder)
  let entries
  try { entries = fs.readdirSync(folder, { withFileTypes: true }) }
  catch (error) {
    if (error.code !== "ENOENT") console.warn(`Warning: Unable to list inspection directories in ${folder}: ${error.message}`)
    return
  }
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith(inspectionPrefix)) removeInspectionDirectory(path.join(folder, entry.name), folder)
  }
}
function installerArchitecture(file) {
  // Keep extracted executables in the installer's AV-excluded output folder.
  const folder = path.dirname(path.resolve(file))
  const dir = fs.mkdtempSync(path.join(folder, inspectionPrefix))
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
    removeInspectionDirectory(dir, folder)
  }
}
module.exports = { peArchitecture, installerArchitecture, cleanInspectionDirectories }

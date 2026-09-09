const fs = require("node:fs")
const path = require("node:path")
const { check, checkArch, ID } = require("./update-protocol")
const { createDeviceConnection } = require("./firebase-updates")
const cloud = require("./update-cloud.json")
function deviceFiles(app, safeStorage) {
  const dir = app.getPath("userData")
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, "kiosk-device.bin")
  const read = () => {
    if (!fs.existsSync(file)) return null
    check(safeStorage.isEncryptionAvailable(), "Windows 설정 복호화를 사용할 수 없습니다.")
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(file)))
  }
  const write = (value) => {
    check(safeStorage.isEncryptionAvailable(), "Windows 설정 암호화를 사용할 수 없습니다.")
    fs.writeFileSync(file + ".tmp", safeStorage.encryptString(JSON.stringify(value)), { mode: 0o600 })
    fs.renameSync(file + ".tmp", file)
  }
  return { read, write, stateFile: path.join(dir, "kiosk-update-state.json") }
}
async function ensureDevice({ app, BrowserWindow, ipcMain, dialog, files }) {
  let config = files.read()
  if (config?.deviceId) check(checkArch(config.arch || "x64") === process.arch, "저장된 장비 설정과 설치파일의 비트수가 다릅니다. 관리자에게 문의해 주세요.")
  if (config?.registered) return config
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 740, height: 540, autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, "setup-preload.js"), contextIsolation: true, nodeIntegration: false },
    })
    const setupUrl = require("node:url").pathToFileURL(path.join(__dirname, "setup.html")).href
    let completed = false, busy = false
    ipcMain.handle("kiosk:setup", async (event, restart = false) => {
      if (event.sender !== win.webContents || event.senderFrame.url !== setupUrl || busy) return { error: "등록 진행 중입니다." }
      busy = true
      try {
        if (restart === true && !config?.registered) { config = null; files.write({}) }
        if (!config?.code) {
          const registration = await dialog.showOpenDialog(win, { title: "배포 PC에서 받은 장비 등록 JSON 선택", properties: ["openFile"], filters: [{ name: "장비 등록", extensions: ["json"] }] })
          if (registration.canceled) return { error: "등록 파일을 선택해 주세요." }
          const parsed = JSON.parse(fs.readFileSync(registration.filePaths[0], "utf8"))
          check(parsed.projectId === cloud.projectId && ID.test(parsed.deviceId || "") && /^property[1-4]$/.test(parsed.property || "") && /^[a-f0-9]{32}$/.test(parsed.code || ""), "잘못된 등록 파일입니다.")
          check(checkArch(parsed.arch || "x64") === process.arch, "등록 파일과 설치파일의 비트수가 다릅니다. 해당 PC용 등록 파일을 선택해 주세요.")
          const envFile = await dialog.showOpenDialog(win, { title: "이 키오스크의 기존 .env.local 설정 파일 선택", properties: ["openFile"], filters: [{ name: "PC 설정 파일", extensions: ["*"] }] })
          if (envFile.canceled) return { error: "기존 PC 설정 파일을 선택해 주세요." }
          const env = require("dotenv").parse(fs.readFileSync(envFile.filePaths[0]))
          check((env.KIOSK_PROPERTY_ID || env.NEXT_PUBLIC_KIOSK_PROPERTY_ID) === parsed.property, "등록 숙소와 PC 설정의 숙소가 다릅니다.")
          check(parsed.property !== "property3" || /^[AB]$/.test(env.KIOSK_BUILDING || ""), "property3 PC 설정에 KIOSK_BUILDING=A 또는 B가 필요합니다.")
          for (const key of Object.keys(env)) check(!/^(NODE_OPTIONS|ELECTRON_|KIOSK_UPDATE_|PATH$|NODE_PATH$)/.test(key), "실행기 제어 설정은 가져올 수 없습니다.")
          config = { projectId: parsed.projectId, deviceId: parsed.deviceId, property: parsed.property, arch: process.arch, code: parsed.code, env }
          files.write(config) // enables safe retry if the pairing response is lost
        }
        await createDeviceConnection(config, files.write).pair()
        delete config.code
        config.registered = true
        files.write(config)
        completed = true
        resolve(config)
        win.close()
        return { ok: true }
      } catch (error) { return { error: error.message } }
      finally { busy = false }
    })
    win.on("closed", () => { ipcMain.removeHandler("kiosk:setup"); if (!completed) reject(new Error("장비 등록을 완료하지 않았습니다.")) })
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    win.webContents.on("will-navigate", (event) => event.preventDefault())
    win.loadURL(setupUrl)
  })
}
module.exports = { deviceFiles, ensureDevice }

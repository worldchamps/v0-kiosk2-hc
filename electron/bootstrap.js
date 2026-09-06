const { app, BrowserWindow, ipcMain, safeStorage, dialog } = require("electron")
const fs = require("node:fs")
const path = require("node:path")
const { deviceFiles, ensureDevice } = require("./device-setup")
const { createDeviceConnection } = require("./firebase-updates")
const { PrivateReleaseProvider } = require("./private-release-provider")
const { createKioskUpdater } = require("./kiosk-updater")
const { safeToInstall } = require("./update-protocol")

if (!app.isPackaged) {
  require("./main")
} else if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.whenReady().then(async () => {
    const files = deviceFiles(app, safeStorage)
    const config = await ensureDevice({ app, BrowserWindow, ipcMain, dialog, files })
    Object.assign(process.env, config.env, {
      NODE_ENV: "production", KIOSK_PROPERTY_ID: config.property,
      NEXT_PUBLIC_KIOSK_PROPERTY_ID: config.property, OVERLAY_MODE: "false",
    })
    // Dedicated kiosks only. Never start the local room-management overlay.
    app.setLoginItemSettings({ openAtLogin: true, path: app.getPath("exe") })
    let heartbeat = { safe: false, at: 0, lastActivity: Date.now() }, locked = false, renderer = null, ack = null
    let activeOperations = 0, lastOperation = Date.now()
    const originalHandle = ipcMain.handle.bind(ipcMain)
    // Existing printer/payment IPC must drain before installation. Block new
    // hardware calls after the renderer has entered maintenance mode.
    ipcMain.handle = (channel, listener) => originalHandle(channel, async (event, ...args) => {
      if (locked) throw new Error("프로그램 업데이트 중입니다.")
      activeOperations++
      lastOperation = Date.now()
      try { return await listener(event, ...args) }
      finally { activeOperations--; lastOperation = Date.now() }
    })
    ipcMain.on("kiosk:public-config", (event) => {
      event.returnValue = {
        propertyId: config.property,
        firebase: Object.fromEntries(["API_KEY", "AUTH_DOMAIN", "DATABASE_URL", "PROJECT_ID", "STORAGE_BUCKET", "MESSAGING_SENDER_ID", "APP_ID"]
          .map((key) => [key, process.env["NEXT_PUBLIC_FIREBASE_" + key] || ""])),
      }
    })
    const localSender = (event) => {
      try { return new URL(event.senderFrame.url).origin === "http://localhost:3000" && event.senderFrame === event.sender.mainFrame }
      catch { return false }
    }
    ipcMain.on("kiosk:update-heartbeat", (event, status) => {
      if (!localSender(event)) return
      renderer = event.sender
      heartbeat = { safe: status?.safe === true, at: Date.now(), lastActivity: Number(status?.lastActivity) || Date.now() }
    })
    ipcMain.on("kiosk:update-ready", (event, nonce) => {
      if (localSender(event) && event.sender === renderer && ack?.nonce === nonce) ack.resolve(true)
    })
    const resume = () => { locked = false; global.kioskMaintenance = false; renderer?.send("kiosk:update-resume") }
    const prepare = async () => {
      if (!safeToInstall(heartbeat) || activeOperations || Date.now() - lastOperation < 10000 ||
        global.kioskHttpActive > 0 || !global.kioskHardwareReady?.() || !renderer || renderer.isDestroyed()) return false
      const nonce = require("node:crypto").randomUUID()
      const confirmed = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 3000)
        ack = { nonce, resolve: (value) => { clearTimeout(timer); resolve(value) } }
        renderer.send("kiosk:update-prepare", nonce)
      })
      ack = null
      if (!confirmed || !safeToInstall(heartbeat) || activeOperations || global.kioskHttpActive > 0 || !global.kioskHardwareReady?.()) { resume(); return false }
      locked = true
      global.kioskMaintenance = true
      return true
    }
    require("./main")
    const publicKey = fs.readFileSync(path.join(process.resourcesPath, "update-public.pem"), "utf8")
    const updater = createKioskUpdater({
      deviceId: config.deviceId, publicKey, version: app.getVersion(), stateFile: files.stateFile,
      pollStatus: createDeviceConnection(config, files.write).pollStatus,
      createUpdater: (options) => new (require("electron-updater").NsisUpdater)({ provider: "custom", updateProvider: PrivateReleaseProvider, ...options }),
      prepare, resume,
      ready: () => heartbeat.at > 0 && Date.now() - heartbeat.at < 10000,
      shutdown: async () => { if (global.shutdownKiosk) await global.shutdownKiosk() },
      recover: () => { app.relaunch(); app.quit() },
    })
    const timer = setInterval(() => updater.tick(), 60000)
    app.on("before-quit", () => clearInterval(timer))
    app.on("second-instance", () => { const win = BrowserWindow.getAllWindows()[0]; win?.show(); win?.focus() })
    updater.tick()
  }).catch((error) => {
    dialog.showErrorBox("키오스크 시작 확인", error.message)
    app.quit()
  })
}

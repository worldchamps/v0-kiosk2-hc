const { app, BrowserWindow, ipcMain } = require("electron")
const path = require("path")
const { SerialPort } = require("serialport")
const overlayButtonModule = require("./overlay-button")

let mainWindow
let billAcceptorPort = null
let billDispenserPort = null

const OVERLAY_MODE = process.env.OVERLAY_MODE === "true"
const KIOSK_PROPERTY = process.env.KIOSK_PROPERTY || "property3"

console.log(`[v0] Starting in ${OVERLAY_MODE ? "OVERLAY" : "FULLSCREEN"} mode for ${KIOSK_PROPERTY}`)

const BILL_ACCEPTOR_CONFIG = {
  path: "COM3", // Windows 기본값, 실제 포트로 변경 필요
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: "none",
}

const BILL_DISPENSER_CONFIG = {
  path: "COM4", // Windows 기본값, 실제 포트로 변경 필요
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: "none",
}

function createWindow() {
  if (!OVERLAY_MODE) {
    mainWindow = new BrowserWindow({
      width: 1920,
      height: 1080,
      fullscreen: true,
      kiosk: false, // 개발 중에는 false, 배포 시 true
      frame: true, // 개발 중에는 true, 배포 시 false
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        nodeIntegration: false,
        contextIsolation: true,
      },
    })

    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self'; " +
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
              "style-src 'self' 'unsafe-inline'; " +
              "img-src 'self' data: https: blob:; " +
              "font-src 'self' data:; " +
              "connect-src 'self' http://localhost:* https://*; " +
              "frame-src 'self';",
          ],
        },
      })
    })

    const isDev = process.env.NODE_ENV !== "production"
    const startUrl = "http://localhost:3000"

    console.log("[v0] Loading URL:", startUrl)
    mainWindow.loadURL(startUrl)

    if (isDev) {
      mainWindow.webContents.openDevTools()
    }

    mainWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription) => {
      console.error("[v0] Failed to load:", errorCode, errorDescription)
      console.log("[v0] Make sure Next.js server is running on http://localhost:3000")
    })

    setTimeout(() => {
      connectBillAcceptor()
      connectBillDispenser()
    }, 2000)
  } else {
    console.log("[v0] Creating overlay button for Property1/2")
    overlayButtonModule.createOverlayButton()
  }
}

async function connectBillAcceptor() {
  try {
    if (billAcceptorPort && billAcceptorPort.isOpen) {
      billAcceptorPort.close()
    }

    billAcceptorPort = new SerialPort({
      path: BILL_ACCEPTOR_CONFIG.path,
      baudRate: BILL_ACCEPTOR_CONFIG.baudRate,
      dataBits: BILL_ACCEPTOR_CONFIG.dataBits,
      stopBits: BILL_ACCEPTOR_CONFIG.stopBits,
      parity: BILL_ACCEPTOR_CONFIG.parity,
      autoOpen: false,
    })

    billAcceptorPort.open((err) => {
      if (err) {
        console.error("[v0] 지폐 인식기 연결 실패:", err.message)
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send("bill-acceptor-status", {
            connected: false,
            error: err.message,
          })
        }
        setTimeout(connectBillAcceptor, 10000)
        return
      }

      console.log("[v0] 지폐 인식기 연결 성공")
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("bill-acceptor-status", {
          connected: true,
        })
      }
    })

    billAcceptorPort.on("data", (data) => {
      console.log("[v0] 지폐 인식기 데이터:", data)
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("bill-acceptor-data", {
          data: Array.from(data),
        })
      }
    })

    billAcceptorPort.on("error", (err) => {
      console.error("[v0] 지폐 인식기 에러:", err)
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("bill-acceptor-status", {
          connected: false,
          error: err.message,
        })
      }
    })

    billAcceptorPort.on("close", () => {
      console.log("[v0] 지폐 인식기 연결 끊김")
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("bill-acceptor-status", {
          connected: false,
        })
      }
      setTimeout(connectBillAcceptor, 5000)
    })
  } catch (error) {
    console.error("[v0] 지폐 인식기 초기화 실패:", error)
    setTimeout(connectBillAcceptor, 10000)
  }
}

async function connectBillDispenser() {
  try {
    if (billDispenserPort && billDispenserPort.isOpen) {
      billDispenserPort.close()
    }

    billDispenserPort = new SerialPort({
      path: BILL_DISPENSER_CONFIG.path,
      baudRate: BILL_DISPENSER_CONFIG.baudRate,
      dataBits: BILL_DISPENSER_CONFIG.dataBits,
      stopBits: BILL_DISPENSER_CONFIG.stopBits,
      parity: BILL_DISPENSER_CONFIG.parity,
      autoOpen: false,
    })

    billDispenserPort.open((err) => {
      if (err) {
        console.error("[v0] 지폐 방출기 연결 실패:", err.message)
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send("bill-dispenser-status", {
            connected: false,
            error: err.message,
          })
        }
        setTimeout(connectBillDispenser, 10000)
        return
      }

      console.log("[v0] 지폐 방출기 연결 성공")
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("bill-dispenser-status", {
          connected: true,
        })
      }
    })

    billDispenserPort.on("data", (data) => {
      console.log("[v0] 지폐 방출기 데이터:", data)
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("bill-dispenser-data", {
          data: Array.from(data),
        })
      }
    })

    billDispenserPort.on("error", (err) => {
      console.error("[v0] 지폐 방출기 에러:", err)
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("bill-dispenser-status", {
          connected: false,
          error: err.message,
        })
      }
    })

    billDispenserPort.on("close", () => {
      console.log("[v0] 지폐 방출기 연결 끊김")
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("bill-dispenser-status", {
          connected: false,
        })
      }
      setTimeout(connectBillDispenser, 5000)
    })
  } catch (error) {
    console.error("[v0] 지폐 방출기 초기화 실패:", error)
    setTimeout(connectBillDispenser, 10000)
  }
}

ipcMain.handle("send-to-bill-acceptor", async (event, command) => {
  if (!billAcceptorPort || !billAcceptorPort.isOpen) {
    return { success: false, error: "지폐 인식기가 연결되지 않았습니다" }
  }

  try {
    const buffer = Buffer.from(command)
    await new Promise((resolve, reject) => {
      billAcceptorPort.write(buffer, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle("send-to-bill-dispenser", async (event, command) => {
  if (!billDispenserPort || !billDispenserPort.isOpen) {
    return { success: false, error: "지폐 방출기가 연결되지 않았습니다" }
  }

  try {
    const buffer = Buffer.from(command)
    await new Promise((resolve, reject) => {
      billDispenserPort.write(buffer, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle("list-serial-ports", async () => {
  try {
    const ports = await SerialPort.list()
    return { success: true, ports }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle("reconnect-bill-acceptor", async () => {
  await connectBillAcceptor()
  return { success: true }
})

ipcMain.handle("reconnect-bill-dispenser", async () => {
  await connectBillDispenser()
  return { success: true }
})

app.whenReady().then(createWindow)

app.on("window-all-closed", () => {
  if (billAcceptorPort && billAcceptorPort.isOpen) {
    billAcceptorPort.close()
  }
  if (billDispenserPort && billDispenserPort.isOpen) {
    billDispenserPort.close()
  }

  if (process.platform !== "darwin") {
    app.quit()
  }
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

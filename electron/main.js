require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local") })

const { app, BrowserWindow, ipcMain } = require("electron")
const path = require("path")
const { SerialPort } = require("serialport")
const overlayButtonModule = require("./overlay-button")
const bixolonPrinter = require("./bixolon-printer")

let mainWindow
let billAcceptorPort = null
let billDispenserPort = null
let printerPort = null

const OVERLAY_MODE = process.env.OVERLAY_MODE === "true"
const KIOSK_PROPERTY_ID = process.env.KIOSK_PROPERTY_ID || "property3"
const isDev = process.env.NODE_ENV !== "production"

if (isDev) {
  console.log(`[v0] Starting in ${OVERLAY_MODE ? "OVERLAY" : "FULLSCREEN"} mode for ${KIOSK_PROPERTY_ID}`)
}

const BILL_ACCEPTOR_CONFIG = {
  path: process.env.BILL_ACCEPTOR_PATH || "COM4", // Windows 기본값, 실제 포트로 변경 필요
  baudRate: process.env.BILL_ACCEPTOR_BAUD_RATE || 9600,
  dataBits: process.env.BILL_ACCEPTOR_DATA_BITS || 8,
  stopBits: process.env.BILL_ACCEPTOR_STOP_BITS || 1,
  parity: process.env.BILL_ACCEPTOR_PARITY || "none",
}

const BILL_DISPENSER_CONFIG = {
  path: process.env.BILL_DISPENSER_PATH || "COM5", // Windows 기본값, 실제 포트로 변경 필요
  baudRate: process.env.BILL_DISPENSER_BAUD_RATE || 9600,
  dataBits: process.env.BILL_DISPENSER_DATA_BITS || 8,
  stopBits: process.env.BILL_DISPENSER_STOP_BITS || 1,
  parity: process.env.BILL_DISPENSER_PARITY || "none",
}

const PRINTER_CONFIG = {
  path: process.env.PRINTER_PATH || "COM2",
  baudRate: Number.parseInt(process.env.PRINTER_BAUD_RATE) || 115200,
  dataBits: Number.parseInt(process.env.PRINTER_DATA_BITS) || 8,
  stopBits: Number.parseInt(process.env.PRINTER_STOP_BITS) || 1,
  parity: process.env.PRINTER_PARITY || "none",
}

function createWindow() {
  if (!OVERLAY_MODE) {
    mainWindow = new BrowserWindow({
      width: 1920,
      height: 1080,
      fullscreen: true,
      kiosk: !isDev,
      frame: isDev,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        nodeIntegration: false,
        contextIsolation: true,
        devTools: isDev,
        autoplayPolicy: "no-user-gesture-required",
      },
    })

    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self'; " +
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; " +
              "style-src 'self' 'unsafe-inline'; " +
              "img-src 'self' data: https: blob:; " +
              "font-src 'self' data:; " +
              "connect-src 'self' http://localhost:* https://*; " +
              "media-src 'self' https://jdpd8txarrh2yidl.public.blob.vercel-storage.com https://*.blob.vercel-storage.com blob: data:; " +
              "frame-src 'self';",
          ],
        },
      })
    })

    const startUrl = isDev
      ? "http://localhost:3000"
      : `file://${path.join(__dirname, "../.next/server/app/index.html")}`

    if (isDev) {
      console.log("[v0] Loading URL:", startUrl)
    }

    mainWindow.loadURL(startUrl)

    mainWindow.once("ready-to-show", () => {
      mainWindow.show()
    })

    mainWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription) => {
      if (isDev) {
        console.error("[v0] Failed to load:", errorCode, errorDescription)
        console.log("[v0] Make sure Next.js server is running on http://localhost:3000")
      }
      if (!isDev) {
        setTimeout(() => {
          mainWindow.loadURL(startUrl)
        }, 3000)
      }
    })

    mainWindow.webContents.on("did-finish-load", () => {
      mainWindow.webContents.executeJavaScript(`
        window.__KIOSK_PROPERTY_ID__ = "${KIOSK_PROPERTY_ID}";
        window.__OVERLAY_MODE__ = ${OVERLAY_MODE};
        console.log("[v0] 🔧 Injected KIOSK_PROPERTY_ID:", "${KIOSK_PROPERTY_ID}");
      `)
    })

    setTimeout(() => {
      connectBillAcceptor()
      connectBillDispenser()
      connectPrinter()
    }, 2000)
  } else {
    if (isDev) {
      console.log("[v0] Creating overlay button for Property1/2")
    }
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
        if (isDev) {
          console.error("[v0] 지폐 인식기 연결 실패:", err.message)
        }
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send("bill-acceptor-status", {
            connected: false,
            error: err.message,
          })
        }
        setTimeout(connectBillAcceptor, 10000)
        return
      }

      if (isDev) {
        console.log("[v0] 지폐 인식기 연결 성공")
      }
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("bill-acceptor-status", {
          connected: true,
        })
      }
    })

    billAcceptorPort.on("data", (data) => {
      if (isDev) {
        console.log("[v0] 지폐 인식기 데이터:", data)
      }
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("bill-acceptor-data", {
          data: Array.from(data),
        })
      }
    })

    billAcceptorPort.on("error", (err) => {
      if (isDev) {
        console.error("[v0] 지폐 인식기 에러:", err)
      }
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("bill-acceptor-status", {
          connected: false,
          error: err.message,
        })
      }
    })

    billAcceptorPort.on("close", () => {
      if (isDev) {
        console.log("[v0] 지폐 인식기 연결 끊김")
      }
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("bill-acceptor-status", {
          connected: false,
        })
      }
      setTimeout(connectBillAcceptor, 5000)
    })
  } catch (error) {
    if (isDev) {
      console.error("[v0] 지폐 인식기 초기화 실패:", error)
    }
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
        if (isDev) {
          console.error("[v0] 지폐 방출기 연결 실패:", err.message)
        }
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send("bill-dispenser-status", {
            connected: false,
            error: err.message,
          })
        }
        setTimeout(connectBillDispenser, 10000)
        return
      }

      if (isDev) {
        console.log("[v0] 지폐 방출기 연결 성공")
      }
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("bill-dispenser-status", {
          connected: true,
        })
      }
    })

    billDispenserPort.on("data", (data) => {
      if (isDev) {
        console.log("[v0] 지폐 방출기 데이터:", data)
      }
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("bill-dispenser-data", {
          data: Array.from(data),
        })
      }
    })

    billDispenserPort.on("error", (err) => {
      if (isDev) {
        console.error("[v0] 지폐 방출기 에러:", err)
      }
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("bill-dispenser-status", {
          connected: false,
          error: err.message,
        })
      }
    })

    billDispenserPort.on("close", () => {
      if (isDev) {
        console.log("[v0] 지폐 방출기 연결 끊김")
      }
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("bill-dispenser-status", {
          connected: false,
        })
      }
      setTimeout(connectBillDispenser, 5000)
    })
  } catch (error) {
    if (isDev) {
      console.error("[v0] 지폐 방출기 초기화 실패:", error)
    }
    setTimeout(connectBillDispenser, 10000)
  }
}

async function connectPrinter() {
  try {
    if (printerPort && printerPort.isOpen) {
      printerPort.close()
    }

    printerPort = new SerialPort({
      path: PRINTER_CONFIG.path,
      baudRate: PRINTER_CONFIG.baudRate,
      dataBits: PRINTER_CONFIG.dataBits,
      stopBits: PRINTER_CONFIG.stopBits,
      parity: PRINTER_CONFIG.parity,
      autoOpen: false,
    })

    printerPort.open((err) => {
      if (err) {
        if (isDev) {
          console.error("[v0] 프린터 연결 실패:", err.message)
        }
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send("printer-status", {
            connected: false,
            error: err.message,
          })
        }
        setTimeout(connectPrinter, 10000)
        return
      }

      if (isDev) {
        console.log(`[v0] 프린터 연결 성공 (${PRINTER_CONFIG.path})`)
      }
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("printer-status", {
          connected: true,
          port: PRINTER_CONFIG.path,
        })
      }
    })

    printerPort.on("error", (err) => {
      if (isDev) {
        console.error("[v0] 프린터 에러:", err)
      }
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("printer-status", {
          connected: false,
          error: err.message,
        })
      }
    })

    printerPort.on("close", () => {
      if (isDev) {
        console.log("[v0] 프린터 연결 끊김")
      }
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("printer-status", {
          connected: false,
        })
      }
      setTimeout(connectPrinter, 5000)
    })
  } catch (error) {
    if (isDev) {
      console.error("[v0] 프린터 초기화 실패:", error)
    }
    setTimeout(connectPrinter, 10000)
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

ipcMain.handle("get-property-id", async () => {
  return KIOSK_PROPERTY_ID
})

ipcMain.handle("get-overlay-mode", async () => {
  return OVERLAY_MODE
})

ipcMain.handle("send-to-printer", async (event, data) => {
  if (!printerPort || !printerPort.isOpen) {
    return { success: false, error: "프린터가 연결되지 않았습니다" }
  }

  try {
    const buffer = Buffer.from(data)
    await new Promise((resolve, reject) => {
      printerPort.write(buffer, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle("reconnect-printer", async () => {
  await connectPrinter()
  return { success: true }
})

ipcMain.handle("get-printer-status", async () => {
  return {
    connected: printerPort && printerPort.isOpen,
    port: PRINTER_CONFIG.path,
  }
})

app.whenReady().then(createWindow)

app.on("window-all-closed", () => {
  if (billAcceptorPort && billAcceptorPort.isOpen) {
    billAcceptorPort.close()
  }
  if (billDispenserPort && billDispenserPort.isOpen) {
    billDispenserPort.close()
  }
  if (printerPort && printerPort.isOpen) {
    printerPort.close()
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

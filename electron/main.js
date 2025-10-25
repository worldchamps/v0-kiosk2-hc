require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local") })

const { app, BrowserWindow, ipcMain } = require("electron")
const path = require("path")
const { SerialPort } = require("serialport")
const overlayButtonModule = require("./overlay-button")
const bixolonPrinter = require("./bixolon-printer")

let mainWindow
let billAcceptorPort = null
let billDispenserPort = null
let printerConnected = false

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
  model: "BK3-3",
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
    console.log(`[PRINTER] Attempting to connect to ${PRINTER_CONFIG.path} using BIXOLON SDK...`)
    console.log(`[PRINTER] Config:`, {
      baudRate: PRINTER_CONFIG.baudRate,
      model: "BK3-3",
    })

    const connected = await bixolonPrinter.connect(PRINTER_CONFIG.path, PRINTER_CONFIG.baudRate)

    if (!connected) {
      console.error("[PRINTER] Failed to connect via BIXOLON SDK")
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("printer-status", {
          connected: false,
          error: "BIXOLON SDK connection failed",
        })
      }
      setTimeout(connectPrinter, 10000)
      return
    }

    printerConnected = true
    console.log(`[PRINTER] Successfully connected to ${PRINTER_CONFIG.path} via BIXOLON SDK`)

    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send("printer-status", {
        connected: true,
        port: PRINTER_CONFIG.path,
        model: "BK3-3",
      })
    }
  } catch (error) {
    console.error("[PRINTER] Initialization failed:", error)
    printerConnected = false
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send("printer-status", {
        connected: false,
        error: error.message,
      })
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
  if (!printerConnected) {
    return { success: false, error: "프린터가 연결되지 않았습니다" }
  }

  try {
    // Initialize printer
    await bixolonPrinter.executeCommand("init")

    // Parse receipt data
    const receiptData = typeof data === "string" ? JSON.parse(data) : data

    // Print header
    await bixolonPrinter.printText("THE BEACH STAY", 1, 2, 17) // Center, Bold, 2x size
    await bixolonPrinter.lineFeed(2)

    // Print divider
    await bixolonPrinter.printText("-------------------------------------", 0, 0, 0)
    await bixolonPrinter.lineFeed(2)

    // Print building
    const buildingChar = receiptData.roomNumber?.charAt(0) || "A"
    await bixolonPrinter.printText(`${buildingChar} BUILDING`, 0, 0, 0)
    await bixolonPrinter.lineFeed(2)

    // Print room info
    const floor = receiptData.floor ? `${receiptData.floor}F` : "2F"
    const roomNumber = receiptData.roomNumber || "0000"
    await bixolonPrinter.printText(`ROOM: ${floor} ${roomNumber}`, 0, 2, 0) // Bold
    await bixolonPrinter.lineFeed(2)

    // Print password
    await bixolonPrinter.printText(`DOOR PASSWORD: ${receiptData.password || "0000"}`, 0, 2, 0)
    await bixolonPrinter.lineFeed(2)

    // Print divider
    await bixolonPrinter.printText("-------------------------------------", 0, 0, 0)
    await bixolonPrinter.lineFeed(2)

    // Print dates
    const checkInDate = receiptData.checkInDate || "N/A"
    const checkOutDate = receiptData.checkOutDate || "N/A"
    await bixolonPrinter.printText(`Check-in: ${checkInDate}`, 0, 0, 0)
    await bixolonPrinter.lineFeed(1)
    await bixolonPrinter.printText(`Check-out: ${checkOutDate}`, 0, 0, 0)
    await bixolonPrinter.lineFeed(3)

    // Cut paper
    await bixolonPrinter.cutPaper()

    return { success: true }
  } catch (error) {
    console.error("[PRINTER] Print error:", error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle("reconnect-printer", async () => {
  await bixolonPrinter.disconnect()
  await connectPrinter()
  return { success: true }
})

ipcMain.handle("get-printer-status", async () => {
  const status = await bixolonPrinter.getStatus()
  return {
    connected: printerConnected,
    port: PRINTER_CONFIG.path,
    model: "BK3-3",
    status: status,
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
  if (printerConnected) {
    bixolonPrinter.disconnect()
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

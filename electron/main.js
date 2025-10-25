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

let printerConnecting = false
let billAcceptorConnecting = false
let billDispenserConnecting = false

const OVERLAY_MODE = process.env.OVERLAY_MODE === "true"
const KIOSK_PROPERTY_ID = process.env.KIOSK_PROPERTY_ID || "property3"
const isDev = process.env.NODE_ENV !== "production"

if (isDev) {
  console.log(`[v0] Starting in ${OVERLAY_MODE ? "OVERLAY" : "FULLSCREEN"} mode for ${KIOSK_PROPERTY_ID}`)
}

const BILL_ACCEPTOR_CONFIG = {
  path: process.env.BILL_ACCEPTOR_PATH || "COM4", // Windows 기본값, 실제 포트로 변경 필요
  baudRate: Number.parseInt(process.env.BILL_ACCEPTOR_BAUD_RATE) || 9600,
  dataBits: Number.parseInt(process.env.BILL_ACCEPTOR_DATA_BITS) || 8,
  stopBits: Number.parseInt(process.env.BILL_ACCEPTOR_STOP_BITS) || 1,
  parity: process.env.BILL_ACCEPTOR_PARITY || "none",
}

const BILL_DISPENSER_CONFIG = {
  path: process.env.BILL_DISPENSER_PATH || "COM5", // Windows 기본값, 실제 포트로 변경 필요
  baudRate: Number.parseInt(process.env.BILL_DISPENSER_BAUD_RATE) || 9600,
  dataBits: Number.parseInt(process.env.BILL_DISPENSER_DATA_BITS) || 8,
  stopBits: Number.parseInt(process.env.BILL_DISPENSER_STOP_BITS) || 1,
  parity: process.env.BILL_DISPENSER_PARITY || "none",
}

const PRINTER_CONFIG = {
  path: process.env.PRINTER_PATH || "COM2",
  baudRate: Number.parseInt(process.env.PRINTER_BAUD_RATE) || 115200, // Changed from 9600 to 115200 bps (manufacturer specification for BIXOLON BK3-3)
  dataBits: Number.parseInt(process.env.PRINTER_DATA_BITS) || 8,
  stopBits: Number.parseInt(process.env.PRINTER_STOP_BITS) || 1,
  parity: process.env.PRINTER_PARITY || "none",
  model: process.env.PRINTER_MODEL || "BK3-3",
  rtscts: true, // Changed from false to true - enables hardware flow control
  xon: false,
  xoff: false,
  xany: false,
}

const BIXOLON_VID = "0419" // BIXOLON vendor ID
const BK3_PID = "2011" // BK3-3 product ID

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

async function detectPrinterPort() {
  try {
    const ports = await SerialPort.list()

    // First, try to find BIXOLON BK3-3 by VID/PID
    const bixolonPort = ports.find(
      (port) =>
        port.vendorId?.toLowerCase() === BIXOLON_VID.toLowerCase() &&
        port.productId?.toLowerCase() === BK3_PID.toLowerCase(),
    )

    if (bixolonPort) {
      if (isDev) {
        console.log("[PRINTER] Detected BIXOLON BK3-3 at:", bixolonPort.path)
        console.log("[PRINTER] VID:", bixolonPort.vendorId, "PID:", bixolonPort.productId)
      }
      return {
        path: bixolonPort.path,
        model: "BK3-3",
        vendorId: bixolonPort.vendorId,
        productId: bixolonPort.productId,
      }
    }

    // Fallback to configured COM port with manual model setting
    if (isDev) {
      console.log("[PRINTER] Using configured port:", PRINTER_CONFIG.path)
      console.log("[PRINTER] Using configured model:", PRINTER_CONFIG.model)
    }
    return {
      path: PRINTER_CONFIG.path,
      model: PRINTER_CONFIG.model,
    }
  } catch (error) {
    if (isDev) {
      console.error("[PRINTER] Failed to detect printer:", error)
    }
    return {
      path: PRINTER_CONFIG.path,
      model: PRINTER_CONFIG.model,
    }
  }
}

async function connectBillAcceptor() {
  if (billAcceptorConnecting) {
    if (isDev) {
      console.log("[v0] 지폐 인식기 연결 시도 중... 대기")
    }
    return
  }

  if (billAcceptorPort && billAcceptorPort.isOpen) {
    if (isDev) {
      console.log("[v0] 지폐 인식기 이미 연결됨")
    }
    return
  }

  billAcceptorConnecting = true

  try {
    if (billAcceptorPort && billAcceptorPort.isOpen) {
      await new Promise((resolve) => {
        billAcceptorPort.close((err) => {
          if (err && isDev) {
            console.error("[v0] 지폐 인식기 포트 닫기 실패:", err.message)
          }
          resolve()
        })
      })
      await new Promise((resolve) => setTimeout(resolve, 500))
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
      billAcceptorConnecting = false

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
    billAcceptorConnecting = false
    if (isDev) {
      console.error("[v0] 지폐 인식기 초기화 실패:", error)
    }
    setTimeout(connectBillAcceptor, 10000)
  }
}

async function connectBillDispenser() {
  if (billDispenserConnecting) {
    if (isDev) {
      console.log("[v0] 지폐 방출기 연결 시도 중... 대기")
    }
    return
  }

  if (billDispenserPort && billDispenserPort.isOpen) {
    if (isDev) {
      console.log("[v0] 지폐 방출기 이미 연결됨")
    }
    return
  }

  billDispenserConnecting = true

  try {
    if (billDispenserPort && billDispenserPort.isOpen) {
      await new Promise((resolve) => {
        billDispenserPort.close((err) => {
          if (err && isDev) {
            console.error("[v0] 지폐 방출기 포트 닫기 실패:", err.message)
          }
          resolve()
        })
      })
      await new Promise((resolve) => setTimeout(resolve, 500))
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
      billDispenserConnecting = false

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
    billDispenserConnecting = false
    if (isDev) {
      console.error("[v0] 지폐 방출기 초기화 실패:", error)
    }
    setTimeout(connectBillDispenser, 10000)
  }
}

async function connectPrinter() {
  if (printerConnecting) {
    if (isDev) {
      console.log("[PRINTER] Connection attempt already in progress, waiting...")
    }
    return
  }

  if (printerPort && printerPort.isOpen) {
    if (isDev) {
      console.log("[PRINTER] Already connected and port is open")
    }
    return
  }

  printerConnecting = true

  try {
    if (printerPort && printerPort.isOpen) {
      await new Promise((resolve) => {
        printerPort.close((err) => {
          if (err && isDev) {
            console.error("[PRINTER] Error closing port:", err.message)
          }
          resolve()
        })
      })
      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    const detectedPrinter = await detectPrinterPort()
    const printerPath = detectedPrinter.path

    if (isDev) {
      console.log(`[PRINTER] Attempting to connect to ${printerPath}...`)
      if (detectedPrinter.model === "BK3-3") {
        console.log(
          `[PRINTER] Detected model: BK3-3 (VID: ${detectedPrinter.vendorId}, PID: ${detectedPrinter.productId})`,
        )
      }
      console.log(`[PRINTER] Config:`, {
        baudRate: PRINTER_CONFIG.baudRate,
        dataBits: PRINTER_CONFIG.dataBits,
        stopBits: PRINTER_CONFIG.stopBits,
        parity: PRINTER_CONFIG.parity,
        flowControl: "RTS/CTS",
      })
    }

    printerPort = new SerialPort({
      path: printerPath,
      baudRate: PRINTER_CONFIG.baudRate,
      dataBits: PRINTER_CONFIG.dataBits,
      stopBits: PRINTER_CONFIG.stopBits,
      parity: PRINTER_CONFIG.parity,
      rtscts: PRINTER_CONFIG.rtscts,
      xon: PRINTER_CONFIG.xon,
      xoff: PRINTER_CONFIG.xoff,
      xany: PRINTER_CONFIG.xany,
      autoOpen: false,
    })

    let errorBeforeClose = null

    printerPort.on("error", (err) => {
      errorBeforeClose = err
      if (isDev) {
        console.error("[PRINTER] ❌ Error event:", err.message)
        console.error("[PRINTER] Error code:", err.code || "N/A")
        console.error("[PRINTER] Error stack:", err.stack)
      }
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("printer-status", {
          connected: false,
          error: err.message,
        })
      }
    })

    printerPort.on("close", (hadError) => {
      if (isDev) {
        console.log("[PRINTER] 🔌 Connection closed")
        console.log("[PRINTER] Close event details:")
        console.log("  - Had error flag:", hadError)
        console.log("  - Error before close:", errorBeforeClose ? errorBeforeClose.message : "None")
        console.log("  - Port was open:", printerPort ? "Yes" : "No")

        if (!errorBeforeClose && !hadError) {
          console.log("[PRINTER] ⚠️  Port closed without error - possible causes:")
          console.log("  1. Hardware disconnected (cable unplugged)")
          console.log("  2. Printer powered off")
          console.log("  3. Wrong serial port settings (baud rate, parity, etc.)")
          console.log("  4. Printer doesn't support these settings")
        }
      }

      errorBeforeClose = null

      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("printer-status", {
          connected: false,
        })
      }
      setTimeout(connectPrinter, 5000)
    })

    printerPort.on("data", (data) => {
      if (isDev) {
        console.log("[PRINTER] Received response from printer:")
        console.log("[PRINTER] Raw bytes:", Array.from(data))
        console.log(
          "[PRINTER] Hex:",
          Array.from(data)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(" "),
        )
        console.log("[PRINTER] ASCII:", data.toString("ascii").replace(/[^\x20-\x7E]/g, "."))
      }
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("printer-data", {
          data: Array.from(data),
          timestamp: new Date().toISOString(),
        })
      }
    })

    printerPort.open((err) => {
      printerConnecting = false

      if (err) {
        if (isDev) {
          console.error("[PRINTER] Failed to connect:", err.message)
          if (err.message.includes("Access denied")) {
            console.log("[PRINTER] Port may still be in use. Will retry in 10 seconds...")
          }
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
        console.log(`[PRINTER] Successfully connected to ${printerPath}`)
        console.log(
          `[PRINTER] Status update: {connected: true, port: "${printerPath}", model: "${detectedPrinter.model}"}`,
        )
      }

      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("printer-status", {
          connected: true,
          port: printerPath,
          model: detectedPrinter.model,
          vendorId: detectedPrinter.vendorId,
          productId: detectedPrinter.productId,
        })
      }
    })
  } catch (error) {
    printerConnecting = false
    if (isDev) {
      console.error("[PRINTER] Initialization failed:", error)
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
    if (isDev) {
      console.log("[PRINTER] Available serial ports:")
      ports.forEach((port) => {
        console.log(`  - ${port.path}`)
        console.log(`    Manufacturer: ${port.manufacturer || "N/A"}`)
        console.log(`    VID: ${port.vendorId || "N/A"}, PID: ${port.productId || "N/A"}`)
      })
    }
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

    if (isDev) {
      console.log("[v0] [PRINTER] Sending command to printer:")
      console.log("[v0] [PRINTER] Buffer length:", buffer.length)
      console.log(
        "[v0] [PRINTER] Hex dump:",
        buffer
          .toString("hex")
          .match(/.{1,2}/g)
          .join(" "),
      )
      console.log("[v0] [PRINTER] ASCII (printable):", buffer.toString("ascii").replace(/[^\x20-\x7E]/g, "."))
    }

    await new Promise((resolve, reject) => {
      printerPort.write(buffer, (err) => {
        if (err) {
          if (isDev) {
            console.error("[v0] [PRINTER] Write error:", err.message)
          }
          reject(err)
        } else {
          if (isDev) {
            console.log("[v0] [PRINTER] Write successful")
          }
          printerPort.drain((drainErr) => {
            if (drainErr) {
              if (isDev) {
                console.error("[v0] [PRINTER] Drain error:", drainErr.message)
              }
              reject(drainErr)
            } else {
              if (isDev) {
                console.log("[v0] [PRINTER] Data drained successfully")
                console.log("[v0] [PRINTER] ⚠️  Note: 'Write successful' means data was sent from computer.")
                console.log("[v0] [PRINTER] ⚠️  This does NOT confirm the printer received or printed it.")
                console.log("[v0] [PRINTER] ⚠️  Check if paper actually came out of the printer!")
              }
              resolve()
            }
          })
        }
      })
    })
    return { success: true }
  } catch (error) {
    if (isDev) {
      console.error("[v0] [PRINTER] Exception:", error.message)
    }
    return { success: false, error: error.message }
  }
})

ipcMain.handle("reconnect-printer", async () => {
  await connectPrinter()
  return {
    success: printerPort && printerPort.isOpen,
    port: printerPort && printerPort.isOpen ? PRINTER_CONFIG.path : null,
  }
})

ipcMain.handle("disconnect-printer", async () => {
  try {
    if (printerPort && printerPort.isOpen) {
      printerPort.close()
      if (isDev) {
        console.log("[PRINTER] Disconnected by user request")
      }
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle("get-printer-status", async () => {
  const isConnected = printerPort && printerPort.isOpen
  const detectedPrinter = await detectPrinterPort()

  return {
    connected: isConnected,
    port: isConnected ? detectedPrinter.path : null,
    model: detectedPrinter.model,
    vendorId: detectedPrinter.vendorId,
    productId: detectedPrinter.productId,
  }
})

ipcMain.handle("connect-printer", async () => {
  await connectPrinter()
  return {
    success: printerPort && printerPort.isOpen,
    port: printerPort && printerPort.isOpen ? PRINTER_CONFIG.path : null,
  }
})

ipcMain.handle("query-printer-status", async () => {
  if (!printerPort || !printerPort.isOpen) {
    return { success: false, error: "프린터가 연결되지 않았습니다" }
  }

  try {
    // DLE EOT n - Real-time status transmission
    // DLE = 0x10, EOT = 0x04, n = 1 (printer status)
    const statusQuery = Buffer.from([0x10, 0x04, 0x01])

    if (isDev) {
      console.log("[PRINTER] Sending real-time status query: DLE EOT 1")
      console.log("[PRINTER] Hex: 10 04 01")
    }

    await new Promise((resolve, reject) => {
      printerPort.write(statusQuery, (err) => {
        if (err) {
          if (isDev) {
            console.error("[PRINTER] Status query write error:", err.message)
          }
          reject(err)
        } else {
          if (isDev) {
            console.log("[PRINTER] Status query sent successfully")
            console.log("[PRINTER] Waiting for printer response...")
          }
          resolve()
        }
      })
    })

    return { success: true }
  } catch (error) {
    if (isDev) {
      console.error("[PRINTER] Status query exception:", error.message)
    }
    return { success: false, error: error.message }
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

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local") })

const { app, BrowserWindow, ipcMain, Menu } = require("electron")
const { spawn } = require("child_process")
const http = require("http")
const path = require("path")
const { SerialPort } = require("serialport")
const overlayButtonModule = require("./overlay-button")
const bixolonPrinter = require("./bixolon-printer")
const hardwareBridge = require("./hardware-server-bridge")
const tossFrontBridge = require("./toss-front-bridge")
const { findSam4sPrinter, receiptHeightMicrons } = require("./sam4s-receipt")

let mainWindow
let billAcceptorPort = null // Now handled by hardware server bridge
let billDispenserPort = null // Now handled by hardware server bridge
let printerPort = null

let printerConnecting = false
let billAcceptorConnecting = false
let billDispenserConnecting = false
let hardwareServerProcess = null
let nextServer = null

tossFrontBridge.on("status", (status) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("toss-front:status", status)
  }
})

const OVERLAY_MODE = process.env.OVERLAY_MODE === "true"
const KIOSK_PROPERTY_ID = process.env.KIOSK_PROPERTY_ID || "property3"
const KIOSK_START_LOCATION = process.env.KIOSK_START_LOCATION || ""
const KIOSK_WINDOW_MODE = process.env.KIOSK_WINDOW_MODE === "true"
const isDev = process.env.NODE_ENV !== "production"
const useKioskChrome = KIOSK_WINDOW_MODE || !isDev

if (isDev) {
  console.log(`[v0] Starting in ${OVERLAY_MODE ? "OVERLAY" : "FULLSCREEN"} mode for ${KIOSK_PROPERTY_ID}`)
}

// CONFIG for hardware devices now managed by hardware server

function getAppDir() {
  return app.isPackaged ? path.join(process.resourcesPath, "app") : path.join(__dirname, "..")
}

function getKioskStartUrl(baseUrl) {
  if (!KIOSK_START_LOCATION) {
    return baseUrl
  }

  const normalizedLocation = KIOSK_START_LOCATION.toUpperCase()
  return `${baseUrl.replace(/\/$/, "")}/kiosk/${encodeURIComponent(normalizedLocation)}`
}

async function startNextServer() {
  if (!app.isPackaged || nextServer) {
    return
  }

  const appDir = getAppDir()
  console.log("[NEXT_SERVER] Starting packaged Next server from:", appDir)

  const next = require("next")
  const nextApp = next({
    dev: false,
    dir: appDir,
    hostname: "localhost",
    port: 3000,
  })
  const handle = nextApp.getRequestHandler()

  await nextApp.prepare()

  nextServer = http.createServer((req, res) => {
    handle(req, res)
  })

  await new Promise((resolve, reject) => {
    nextServer.once("error", (error) => {
      if (error && error.code === "EADDRINUSE") {
        console.warn("[NEXT_SERVER] Port 3000 already in use; using existing server")
        nextServer = null
        resolve()
        return
      }
      reject(error)
    })
    nextServer.listen(3000, "localhost", () => {
      nextServer.off("error", reject)
      console.log("[NEXT_SERVER] Listening on http://localhost:3000")
      resolve()
    })
  })
}

function getHardwareServerDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "hardware_server")
    : path.join(__dirname, "..", "hardware_server")
}

function startHardwareServer() {
  if (hardwareServerProcess && !hardwareServerProcess.killed) {
    return
  }

  const hardwareServerDir = getHardwareServerDir()
  const mainPy = path.join(hardwareServerDir, "main.py")

  if (!require("fs").existsSync(mainPy)) {
    console.error("[HARDWARE_SERVER] main.py not found:", mainPy)
    return
  }

  console.log("[HARDWARE_SERVER] Starting:", mainPy)

  hardwareServerProcess = spawn("python", ["-u", mainPy], {
    cwd: hardwareServerDir,
    windowsHide: true,
    stdio: isDev ? "inherit" : "ignore",
  })

  hardwareServerProcess.on("exit", (code) => {
    console.log("[HARDWARE_SERVER] Exited:", code)
    hardwareServerProcess = null
  })

  hardwareServerProcess.on("error", (error) => {
    console.error("[HARDWARE_SERVER] Failed to start:", error)
  })
}

const PRINTER_CONFIG = {
  path: process.env.PRINTER_PATH || "COM2",
  baudRate: Number.parseInt(process.env.PRINTER_BAUD_RATE) || 115200, // Changed from 9600 to 115200 (working version setting)
  dataBits: Number.parseInt(process.env.PRINTER_DATA_BITS) || 8,
  stopBits: Number.parseInt(process.env.PRINTER_STOP_BITS) || 1,
  parity: process.env.PRINTER_PARITY || "none",
  model: process.env.PRINTER_MODEL || "BK3-3",
  rtscts: false, // Disabled hardware flow control (not needed for RS232)
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
      kiosk: useKioskChrome,
      frame: !useKioskChrome,
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        nodeIntegration: false,
        contextIsolation: true,
        devTools: isDev && !KIOSK_WINDOW_MODE,
        autoplayPolicy: "no-user-gesture-required",
      },
    })

    if (useKioskChrome) {
      Menu.setApplicationMenu(null)
      mainWindow.setMenuBarVisibility(false)
    }

    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      let isLocalApp = false
      try {
        const hostname = new URL(details.url).hostname
        isLocalApp = hostname === "localhost" || hostname === "127.0.0.1"
      } catch {
        isLocalApp = false
      }

      if (!isLocalApp) {
        callback({ responseHeaders: details.responseHeaders })
        return
      }

      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self'; " +
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://*.firebasedatabase.app https://*.firebaseio.com; " +
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data: https: blob:; " +
            "font-src 'self' data:; " +
            "connect-src 'self' http://localhost:* https://* wss://*; " +
            "media-src 'self' https://jdpd8txarrh2yidl.public.blob.vercel-storage.com https://*.blob.vercel-storage.com blob: data:; " +
            "frame-src 'self';",
          ],
        },
      })
    })

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("https://pay.toss.im/") || url.startsWith("https://toss.im/")) {
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            width: 520,
            height: 760,
            parent: mainWindow,
            modal: true,
            autoHideMenuBar: true,
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true,
            },
          },
        }
      }
      return { action: "deny" }
    })

    const startUrl = getKioskStartUrl("http://localhost:3000")

    if (isDev) {
      console.log("[v0] Loading URL:", startUrl)
    }

    mainWindow.loadURL(startUrl)

    mainWindow.once("ready-to-show", () => {
      mainWindow.show()
    })

    mainWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription) => {
      console.error("[v0] Failed to load:", errorCode, errorDescription)
      console.log("[v0] Retrying in 3 seconds... (Make sure Next.js server is running on http://localhost:3000)")
      // 항상 재시도 - NODE_ENV 설정과 관계없이 서버 준비될 때까지 반복
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL(startUrl)
        }
      }, 3000)
    })

    mainWindow.webContents.on("did-finish-load", () => {
      mainWindow.webContents.executeJavaScript(`
        window.__KIOSK_PROPERTY_ID__ = "${KIOSK_PROPERTY_ID}";
        window.__OVERLAY_MODE__ = ${OVERLAY_MODE};
        console.log("[v0] 🔧 Injected KIOSK_PROPERTY_ID:", "${KIOSK_PROPERTY_ID}");
      `)
    })

    setTimeout(() => {
      startHardwareServer()
      tossFrontBridge.reconnect()

      // Hardware Server Bridge initialization
      hardwareBridge.onStatus((status) => {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send("bill-acceptor-status", { connected: status.connected })
          mainWindow.webContents.send("bill-dispenser-status", { connected: status.connected })
        }
      })

      hardwareBridge.onMessage((msg) => {
        if (!mainWindow || !mainWindow.webContents) return

        if (msg.type === "acceptor_event") {
          // Reconstruct Event packet: $ E S [event] [check]
          const event = msg.event
          const check = (0x45 + 0x53 + event) & 0xFF
          mainWindow.webContents.send("bill-acceptor-data", { data: [0x24, 0x45, 0x53, event, check] })
        } else if (msg.type === "acceptor_bill_data") {
          // Reconstruct Bill Data packet: $ g b [value] [check]
          const value = msg.value
          const check = (0x67 + 0x62 + value) & 0xFF
          mainWindow.webContents.send("bill-acceptor-data", { data: [0x24, 0x67, 0x62, value, check] })
        } else if (msg.type === "dispenser_data") {
          mainWindow.webContents.send("bill-dispenser-data", { data: msg.data })
        } else if (msg.type === "acceptor_raw") {
          mainWindow.webContents.send("bill-acceptor-data", { data: msg.packet })
        } else if (msg.type === "acceptor_ok") {
          // Reconstruct OK packet: $ O K [data] [check]
          // $ = 0x24, O = 0x4F, K = 0x4B
          const data = msg.data
          const check = (0x4F + 0x4B + data) & 0xFF
          mainWindow.webContents.send("bill-acceptor-data", { data: [0x24, 0x4F, 0x4B, data, check] })
        } else if (msg.type === "acceptor_ng") {
          // Reconstruct NG packet: $ N G [data] [check]
          // $ = 0x24, N = 0x4E, G = 0x47
          const data = msg.data
          const check = (0x4E + 0x47 + data) & 0xFF
          mainWindow.webContents.send("bill-acceptor-data", { data: [0x24, 0x4E, 0x47, data, check] })
        }
      })

      setTimeout(() => {
        hardwareBridge.connect()
      }, 3000)
      // connectPrinter() // Disabled: Printer is now managed by hardware_server
    }, 2000)
  } else {
    if (isDev) {
      console.log("[v0] Creating overlay button for Property1/2")
    }
    startHardwareServer()
    hardwareBridge.connect()
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

// Printer connection logic remains

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
  const success = hardwareBridge.send({ type: "raw_acceptor", data: Array.from(command) })
  return { success }
})

ipcMain.handle("send-to-bill-dispenser", async (event, command) => {
  const success = hardwareBridge.send({ type: "raw_dispenser", data: Array.from(command) })
  return { success }
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
  startHardwareServer()
  hardwareBridge.connect()
  return { success: true }
})

ipcMain.handle("reconnect-bill-dispenser", async () => {
  startHardwareServer()
  hardwareBridge.connect()
  return { success: true }
})

ipcMain.handle("get-property-id", async () => {
  return KIOSK_PROPERTY_ID
})

ipcMain.handle("get-overlay-mode", async () => {
  return OVERLAY_MODE
})

ipcMain.handle("toss-front:get-status", async () => tossFrontBridge.status)

ipcMain.handle("toss-front:reconnect", async () => {
  tossFrontBridge.reconnect()
  return tossFrontBridge.status
})

ipcMain.handle("toss-front:scan-reservation-qr", async () => {
  try {
    const value = await tossFrontBridge.requestQrScan()
    return { success: true, value }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle("toss-front:request-payment", async (_event, payload) => {
  try {
    const payment = await tossFrontBridge.requestPayment(payload)
    return { success: true, payment }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle("toss-front:recover-payment", async (_event, payload) => {
  try {
    const payment = await tossFrontBridge.recoverPayment(payload)
    return { success: true, payment }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle("toss-front:cancel-payment", async (_event, payment) => {
  try {
    const cancel = await tossFrontBridge.cancelPayment(payment)
    return { success: true, cancel }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle("send-to-printer", async (event, data) => {
  // Legacy handler (keep for now or redirect?)
  // For consistency with hardware server, we might want to use that instead.
  // But let's just add the new ones for now.
  hardwareBridge.send({ type: "printer_raw", data: Array.from(Buffer.from(data)) })
  return { success: true }
})

// New handlers for Hardware Server Printer
ipcMain.handle("print-to-bixolon", async (event, text, options = {}) => {
  hardwareBridge.send({
    type: "printer_print",
    text,
    alignment: options.alignment,
    attribute: options.attribute,
    text_size: options.textSize,
    code_page: options.codePage,
  })
  return true
})

ipcMain.handle("cut-bixolon-paper", async () => {
  hardwareBridge.send({ type: "printer_cut" })
  return true
})

ipcMain.handle("send-raw-to-bixolon", async (event, data) => {
  hardwareBridge.send({ type: "printer_raw", data })
  return true
})

ipcMain.handle("print-to-sam4s", async (_event, html) => {
  if (KIOSK_PROPERTY_ID !== "property4") {
    return { success: false, error: "SAM4S 인쇄는 property4에서만 사용할 수 있습니다." }
  }

  if (typeof html !== "string" || !html.trim() || html.length > 200_000) {
    return { success: false, error: "인쇄할 SAM4S 영수증 데이터가 올바르지 않습니다." }
  }

  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true },
  })

  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    await printWindow.webContents.executeJavaScript("document.fonts ? document.fonts.ready : Promise.resolve()")

    const printers = await printWindow.webContents.getPrintersAsync()
    const printer = findSam4sPrinter(printers, process.env.SAM4S_PRINTER_NAME || "")
    if (!printer) {
      const available = printers.map((item) => item.displayName || item.name).filter(Boolean).join(", ")
      return {
        success: false,
        error: `SAM4S GCUBE 프린터를 찾지 못했습니다. 설치된 프린터: ${available || "없음"}`,
      }
    }

    const contentHeight = await printWindow.webContents.executeJavaScript(
      "Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)",
    )
    const pageSize = { width: 80_000, height: receiptHeightMicrons(contentHeight) }

    return await new Promise((resolve) => {
      printWindow.webContents.print(
        {
          silent: true,
          printBackground: true,
          deviceName: printer.name,
          margins: { marginType: "none" },
          pageSize,
        },
        (success, failureReason) => {
          resolve(
            success
              ? { success: true, printer: printer.displayName || printer.name }
              : { success: false, error: failureReason || "SAM4S 인쇄에 실패했습니다." },
          )
        },
      )
    })
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy()
  }
})

ipcMain.handle("reconnect-printer", async () => {
  await connectPrinter()
  return {
    success: printerPort && printerPort.isOpen,
    port: printerPort && printerPort.isOpen ? PRINTER_CONFIG.path : null,
  }
})

ipcMain.handle("get-hardware-status", async () => {
  return {
    connected: hardwareBridge.isConnected
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

ipcMain.handle("printer:list-ports", async () => {
  try {
    const ports = await SerialPort.list()
    if (isDev) {
      console.log("[PRINTER] 📋 Available serial ports:")
      ports.forEach((port) => {
        console.log(`  - ${port.path}`)
        if (port.manufacturer) console.log(`    Manufacturer: ${port.manufacturer}`)
        if (port.vendorId) console.log(`    VID: ${port.vendorId}, PID: ${port.productId}`)
      })
    }
    return { success: true, ports }
  } catch (error) {
    if (isDev) {
      console.error("[PRINTER] ❌ Failed to list ports:", error.message)
    }
    return { success: false, error: error.message }
  }
})

ipcMain.handle("printer:connect", async (event, portPath) => {
  try {
    // Close existing connection if any
    if (printerPort && printerPort.isOpen) {
      await new Promise((resolve) => {
        printerPort.close(() => resolve())
      })
      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    if (isDev) {
      console.log(`[PRINTER] 🔌 Connecting to ${portPath}...`)
    }

    printerPort = new SerialPort({
      path: portPath,
      baudRate: 115200,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      autoOpen: false,
    })

    await new Promise((resolve, reject) => {
      printerPort.open((err) => {
        if (err) reject(err)
        else resolve()
      })
    })

    if (isDev) {
      console.log("[PRINTER] ✅ Connected successfully")
    }

    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send("printer-status", {
        connected: true,
        port: portPath,
      })
    }

    return { success: true }
  } catch (error) {
    if (isDev) {
      console.error("[PRINTER] ❌ Connection failed:", error.message)
    }
    return { success: false, error: error.message }
  }
})

ipcMain.handle("printer:disconnect", async () => {
  try {
    if (printerPort && printerPort.isOpen) {
      await new Promise((resolve) => {
        printerPort.close(() => resolve())
      })
      if (isDev) {
        console.log("[PRINTER] 🔌 Disconnected")
      }
    }
    return { success: true }
  } catch (error) {
    if (isDev) {
      console.error("[PRINTER] ❌ Disconnect failed:", error.message)
    }
    return { success: false, error: error.message }
  }
})

ipcMain.handle("printer:is-connected", async () => {
  const connected = printerPort && printerPort.isOpen
  return { connected }
})

ipcMain.handle("printer:print-receipt", async (event, receiptData) => {
  if (!printerPort || !printerPort.isOpen) {
    return { success: false, error: "프린터가 연결되지 않았습니다" }
  }

  try {
    const commands = []

    // Initialize printer
    commands.push(0x1b, 0x40) // ESC @ - Initialize
    commands.push(0x1b, 0x74, 0x00) // ESC t 0 - Set codepage PC437

    // Print property name
    if (receiptData.propertyName) {
      commands.push(0x1b, 0x21, 0x30) // ESC ! 48 - Double height + bold
      commands.push(...Buffer.from(receiptData.propertyName, "utf-8"))
      commands.push(0x0d, 0x0a) // CR LF
      commands.push(0x0d, 0x0a) // CR LF
    }

    // Print separator
    commands.push(0x1b, 0x21, 0x00) // ESC ! 0 - Normal mode
    commands.push(...Buffer.from("-".repeat(37), "utf-8"))
    commands.push(0x0d, 0x0a) // CR LF
    commands.push(0x0d, 0x0a) // CR LF

    // Print building
    if (receiptData.building) {
      commands.push(...Buffer.from(receiptData.building, "utf-8"))
      commands.push(0x0d, 0x0a) // CR LF
      commands.push(0x0d, 0x0a) // CR LF
    }

    // Print room
    if (receiptData.room) {
      commands.push(...Buffer.from(`ROOM: ${receiptData.room}`, "utf-8"))
      commands.push(0x0d, 0x0a) // CR LF
      commands.push(0x0d, 0x0a) // CR LF
    }

    // Print password
    if (receiptData.password) {
      commands.push(...Buffer.from(`DOOR PASSWORD: ${receiptData.password}`, "utf-8"))
      commands.push(0x0d, 0x0a) // CR LF
      commands.push(0x0d, 0x0a) // CR LF
    }

    // Print separator
    commands.push(...Buffer.from("-".repeat(37), "utf-8"))
    commands.push(0x0d, 0x0a) // CR LF
    commands.push(0x0d, 0x0a) // CR LF

    // Print dates
    if (receiptData.checkIn) {
      commands.push(...Buffer.from(`Check-in: ${receiptData.checkIn}`, "utf-8"))
      commands.push(0x0d, 0x0a) // CR LF
    }
    if (receiptData.checkOut) {
      commands.push(...Buffer.from(`Check-out: ${receiptData.checkOut}`, "utf-8"))
      commands.push(0x0d, 0x0a) // CR LF
    }

    // Feed and cut
    commands.push(0x0d, 0x0a) // CR LF
    commands.push(0x0d, 0x0a) // CR LF
    commands.push(0x1d, 0x56, 0x01) // GS V 1 - Cut paper

    const buffer = Buffer.from(commands)

    if (isDev) {
      console.log("[PRINTER] 📄 Printing receipt...")
      console.log("[PRINTER] Buffer length:", buffer.length)
    }

    await new Promise((resolve, reject) => {
      printerPort.write(buffer, (err) => {
        if (err) reject(err)
        else {
          printerPort.drain((drainErr) => {
            if (drainErr) reject(drainErr)
            else resolve()
          })
        }
      })
    })

    if (isDev) {
      console.log("[PRINTER] ✅ Receipt printed successfully")
    }

    return { success: true }
  } catch (error) {
    if (isDev) {
      console.error("[PRINTER] ❌ Print failed:", error.message)
    }
    return { success: false, error: error.message }
  }
})

ipcMain.handle("printer:print-test", async () => {
  if (!printerPort || !printerPort.isOpen) {
    return { success: false, error: "프린터가 연결되지 않았습니다" }
  }

  try {
    const commands = []

    // Initialize
    commands.push(0x1b, 0x40) // ESC @ - Initialize
    commands.push(0x1b, 0x74, 0x00) // ESC t 0 - Set codepage

    // Print test header
    commands.push(0x1b, 0x21, 0x30) // ESC ! 48 - Double height + bold
    commands.push(...Buffer.from("PRINTER TEST", "utf-8"))
    commands.push(0x0d, 0x0a) // CR LF
    commands.push(0x0d, 0x0a) // CR LF

    // Print normal text
    commands.push(0x1b, 0x21, 0x00) // ESC ! 0 - Normal
    commands.push(...Buffer.from("This is a test print.", "utf-8"))
    commands.push(0x0d, 0x0a) // CR LF
    commands.push(...Buffer.from("If you can read this,", "utf-8"))
    commands.push(0x0d, 0x0a) // CR LF
    commands.push(...Buffer.from("the printer is working!", "utf-8"))
    commands.push(0x0d, 0x0a) // CR LF
    commands.push(0x0d, 0x0a) // CR LF

    // Print timestamp
    const now = new Date().toISOString()
    commands.push(...Buffer.from(`Time: ${now}`, "utf-8"))
    commands.push(0x0d, 0x0a) // CR LF
    commands.push(0x0d, 0x0a) // CR LF

    // Feed and cut
    commands.push(0x0d, 0x0a) // CR LF
    commands.push(0x1d, 0x56, 0x01) // GS V 1 - Cut

    const buffer = Buffer.from(commands)

    if (isDev) {
      console.log("[PRINTER] 📄 Printing test page...")
    }

    await new Promise((resolve, reject) => {
      printerPort.write(buffer, (err) => {
        if (err) reject(err)
        else {
          printerPort.drain((drainErr) => {
            if (drainErr) reject(drainErr)
            else resolve()
          })
        }
      })
    })

    if (isDev) {
      console.log("[PRINTER] ✅ Test page printed successfully")
    }

    return { success: true }
  } catch (error) {
    if (isDev) {
      console.error("[PRINTER] ❌ Test print failed:", error.message)
    }
    return { success: false, error: error.message }
  }
})

app.whenReady().then(async () => {
  if (!OVERLAY_MODE) {
    await startNextServer()
  }
  createWindow()
})

app.on("window-all-closed", () => {
  tossFrontBridge.close()

  if (nextServer) {
    nextServer.close()
    nextServer = null
  }

  if (hardwareServerProcess && !hardwareServerProcess.killed) {
    hardwareServerProcess.kill()
  }

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

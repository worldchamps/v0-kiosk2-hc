const path = require("path")
const fs = require("fs")
const { app, BrowserWindow, ipcMain } = require("electron")
const { SerialPort } = require("serialport")
const overlayButtonModule = require("./overlay-button")
const { startNextServer, stopNextServer } = require("./server")

// Try to load .env.local from multiple locations
const possibleEnvPaths = [
  path.join(__dirname, "..", ".env.local"),
  path.join(process.resourcesPath, ".env.local"),
  path.join(process.cwd(), ".env.local"),
]

let envLoaded = false
for (const envPath of possibleEnvPaths) {
  if (fs.existsSync(envPath)) {
    console.log("[v0] Loading environment from:", envPath)
    require("dotenv").config({ path: envPath })
    envLoaded = true
    break
  }
}

if (!envLoaded) {
  console.error("[v0] No environment file found")
}

let mainWindow
let billAcceptorPort = null
let billDispenserPort = null

const OVERLAY_MODE = process.env.OVERLAY_MODE === "true"
const KIOSK_PROPERTY_ID = process.env.KIOSK_PROPERTY_ID || "property3"
const isDev = process.env.NODE_ENV !== "production"

if (isDev) {
  console.log(`[v0] Starting in ${OVERLAY_MODE ? "OVERLAY" : "FULLSCREEN"} mode for ${KIOSK_PROPERTY_ID}`)
}

const BILL_ACCEPTOR_CONFIG = {
  path: process.env.BILL_ACCEPTOR_PATH || "COM3", // Windows 기본값, 실제 포트로 변경 필요
  baudRate: process.env.BILL_ACCEPTOR_BAUD_RATE || 9600,
  dataBits: process.env.BILL_ACCEPTOR_DATA_BITS || 8,
  stopBits: process.env.BILL_ACCEPTOR_STOP_BITS || 1,
  parity: process.env.BILL_ACCEPTOR_PARITY || "none",
}

const BILL_DISPENSER_CONFIG = {
  path: process.env.BILL_DISPENSER_PATH || "COM4", // Windows 기본값, 실제 포트로 변경 필요
  baudRate: process.env.BILL_DISPENSER_BAUD_RATE || 9600,
  dataBits: process.env.BILL_DISPENSER_DATA_BITS || 8,
  stopBits: process.env.BILL_DISPENSER_STOP_BITS || 1,
  parity: process.env.BILL_DISPENSER_PARITY || "none",
}

async function createWindow() {
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
        devTools: true, // Always enable DevTools for debugging
      },
    })

    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self'; " +
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.firebasedatabase.app; " +
              "style-src 'self' 'unsafe-inline'; " +
              "img-src 'self' data: https: blob:; " +
              "font-src 'self' data:; " +
              "connect-src 'self' http://localhost:* https://* wss://*.firebasedatabase.app; " +
              "frame-src 'self';",
          ],
        },
      })
    })

    let startUrl
    if (isDev) {
      startUrl = "http://localhost:3000"
      console.log("[v0] Development mode - connecting to:", startUrl)
    } else {
      console.log("[v0] Production mode - starting Next.js server...")

      // Show loading screen while server starts
      mainWindow.loadURL(
        "data:text/html;charset=utf-8," +
          encodeURIComponent(`
        <!DOCTYPE html>
        <html>
          <head>
            <style>
              body {
                margin: 0;
                padding: 0;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              }
              .loader {
                text-align: center;
                color: white;
              }
              .spinner {
                border: 4px solid rgba(255,255,255,0.3);
                border-top: 4px solid white;
                border-radius: 50%;
                width: 50px;
                height: 50px;
                animation: spin 1s linear infinite;
                margin: 0 auto 20px;
              }
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
              h1 { font-size: 24px; margin: 0 0 10px 0; }
              p { font-size: 14px; opacity: 0.9; }
            </style>
          </head>
          <body>
            <div class="loader">
              <div class="spinner"></div>
              <h1>TheBeachStay Kiosk</h1>
              <p>서버를 시작하는 중입니다...</p>
            </div>
          </body>
        </html>
      `),
      )

      mainWindow.show()

      try {
        startUrl = await startNextServer(3000)
        console.log("[v0] Next.js server started successfully, loading app...")

        // Wait a bit for server to be fully ready
        await new Promise((resolve) => setTimeout(resolve, 1000))

        await mainWindow.loadURL(startUrl)
        console.log("[v0] App loaded successfully")
      } catch (error) {
        console.error("[v0] Failed to start Next.js server:", error)

        // Show error screen
        mainWindow.loadURL(
          "data:text/html;charset=utf-8," +
            encodeURIComponent(`
          <!DOCTYPE html>
          <html>
            <head>
              <style>
                body {
                  margin: 0;
                  padding: 0;
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  height: 100vh;
                  background: #1a1a1a;
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                  color: white;
                }
                .error {
                  text-align: center;
                  max-width: 600px;
                  padding: 40px;
                }
                h1 { color: #ff6b6b; margin-bottom: 20px; }
                p { line-height: 1.6; margin-bottom: 10px; }
                code {
                  background: #2a2a2a;
                  padding: 2px 8px;
                  border-radius: 4px;
                  font-size: 12px;
                }
              </style>
            </head>
            <body>
              <div class="error">
                <h1>⚠️ 서버 시작 실패</h1>
                <p>Next.js 서버를 시작할 수 없습니다.</p>
                <p><code>${error.message}</code></p>
                <p style="margin-top: 30px; font-size: 14px; opacity: 0.7;">
                  앱을 다시 시작하거나 관리자에게 문의하세요.
                </p>
              </div>
            </body>
          </html>
        `),
        )
        return
      }
    }

    mainWindow.webContents.openDevTools()

    mainWindow.once("ready-to-show", () => {
      if (!mainWindow.isVisible()) {
        mainWindow.show()
      }
    })

    mainWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription, validatedURL) => {
      console.error("[v0] Failed to load:", errorCode, errorDescription, validatedURL)
      if (isDev) {
        console.log("[v0] Make sure Next.js server is running on http://localhost:3000")
      } else {
        console.log("[v0] Retrying in 3 seconds...")
        setTimeout(() => {
          mainWindow.loadURL(startUrl)
        }, 3000)
      }
    })

    mainWindow.webContents.on("console-message", (event, level, message, line, sourceId) => {
      console.log(`[v0] Browser console [${level}]:`, message)
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

  if (!isDev) {
    stopNextServer()
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

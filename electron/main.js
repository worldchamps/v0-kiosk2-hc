const { app, BrowserWindow, ipcMain } = require("electron")
const path = require("path")
const { SerialPort } = require("serialport")
const { createOverlayButton } = require("./overlay-button")

let mainWindow
let billAcceptorPort = null
let billDispenserPort = null

const OVERLAY_MODE = process.env.OVERLAY_MODE === "true"
const KIOSK_PROPERTY = process.env.KIOSK_PROPERTY || "property3"

console.log(`[v0] Starting in ${OVERLAY_MODE ? "OVERLAY" : "FULLSCREEN"} mode for ${KIOSK_PROPERTY}`)

// 시리얼 포트 설정 (나중에 설정 파일로 분리 가능)
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

    // 개발 모드: Next.js dev 서버
    // 프로덕션: 빌드된 파일
    const isDev = process.env.NODE_ENV !== "production"
    const startUrl = isDev
      ? "http://localhost:3000"
      : `file://${path.join(__dirname, "../.next/server/app/index.html")}`

    mainWindow.loadURL(startUrl)

    // 개발 모드에서는 DevTools 열기
    if (isDev) {
      mainWindow.webContents.openDevTools()
    }
  } else {
    console.log("[v0] Creating overlay button for Property1/2")
    createOverlayButton()
  }

  // 하드웨어 자동 연결 시도
  setTimeout(() => {
    connectBillAcceptor()
    connectBillDispenser()
  }, 2000)
}

// 지폐 인식기 연결
async function connectBillAcceptor() {
  try {
    // 이미 연결되어 있으면 닫기
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
        mainWindow.webContents.send("bill-acceptor-status", {
          connected: false,
          error: err.message,
        })
        // 10초 후 재시도
        setTimeout(connectBillAcceptor, 10000)
        return
      }

      console.log("[v0] 지폐 인식기 연결 성공")
      mainWindow.webContents.send("bill-acceptor-status", {
        connected: true,
      })
    })

    // 데이터 수신
    billAcceptorPort.on("data", (data) => {
      console.log("[v0] 지폐 인식기 데이터:", data)
      mainWindow.webContents.send("bill-acceptor-data", {
        data: Array.from(data),
      })
    })

    // 에러 처리
    billAcceptorPort.on("error", (err) => {
      console.error("[v0] 지폐 인식기 에러:", err)
      mainWindow.webContents.send("bill-acceptor-status", {
        connected: false,
        error: err.message,
      })
    })

    // 연결 끊김
    billAcceptorPort.on("close", () => {
      console.log("[v0] 지폐 인식기 연결 끊김")
      mainWindow.webContents.send("bill-acceptor-status", {
        connected: false,
      })
      // 5초 후 재연결 시도
      setTimeout(connectBillAcceptor, 5000)
    })
  } catch (error) {
    console.error("[v0] 지폐 인식기 초기화 실패:", error)
    setTimeout(connectBillAcceptor, 10000)
  }
}

// 지폐 방출기 연결
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
        mainWindow.webContents.send("bill-dispenser-status", {
          connected: false,
          error: err.message,
        })
        setTimeout(connectBillDispenser, 10000)
        return
      }

      console.log("[v0] 지폐 방출기 연결 성공")
      mainWindow.webContents.send("bill-dispenser-status", {
        connected: true,
      })
    })

    billDispenserPort.on("data", (data) => {
      console.log("[v0] 지폐 방출기 데이터:", data)
      mainWindow.webContents.send("bill-dispenser-data", {
        data: Array.from(data),
      })
    })

    billDispenserPort.on("error", (err) => {
      console.error("[v0] 지폐 방출기 에러:", err)
      mainWindow.webContents.send("bill-dispenser-status", {
        connected: false,
        error: err.message,
      })
    })

    billDispenserPort.on("close", () => {
      console.log("[v0] 지폐 방출기 연결 끊김")
      mainWindow.webContents.send("bill-dispenser-status", {
        connected: false,
      })
      setTimeout(connectBillDispenser, 5000)
    })
  } catch (error) {
    console.error("[v0] 지폐 방출기 초기화 실패:", error)
    setTimeout(connectBillDispenser, 10000)
  }
}

// IPC 핸들러: 지폐 인식기 명령 전송
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

// IPC 핸들러: 지폐 방출기 명령 전송
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

// IPC 핸들러: 사용 가능한 시리얼 포트 목록
ipcMain.handle("list-serial-ports", async () => {
  try {
    const ports = await SerialPort.list()
    return { success: true, ports }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// IPC 핸들러: 수동 재연결
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
  // 시리얼 포트 정리
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

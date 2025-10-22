const { BrowserWindow, ipcMain, screen } = require("electron")
const path = require("path")
const { exec } = require("child_process")

let overlayButton = null
let kioskPopup = null
let aggressiveCheckInterval = null

const AGGRESSIVE_MODE = process.env.AGGRESSIVE_TOPMOST === "true"
const CHECK_INTERVAL = AGGRESSIVE_MODE ? 10 : 10 // 10ms 기본값

/**
 * Electron 고급 메서드로 최상위 유지
 * screen-saver 레벨은 대부분의 키오스크 프로그램보다 높은 우선순위
 */
function keepOnTopAggressive(window) {
  if (!window || window.isDestroyed()) return

  // 여러 레벨을 시도하여 최대한 높은 우선순위 확보
  window.setAlwaysOnTop(true, "screen-saver", 1)
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.moveTop()
  window.focus()
}

/**
 * 최상위 유지 시작
 * AGGRESSIVE_MODE=true 시 10ms마다 체크 (4GB RAM 권장)
 * AGGRESSIVE_MODE=false 시 3초마다 체크 (2GB RAM 환경)
 */
function startTopmostKeeper(window) {
  stopTopmostKeeper()

  // 초기 설정
  keepOnTopAggressive(window)

  aggressiveCheckInterval = setInterval(() => {
    if (window && !window.isDestroyed()) {
      keepOnTopAggressive(window)
    }
  }, CHECK_INTERVAL)

  console.log(`[v0] Topmost keeper started: ${AGGRESSIVE_MODE ? "AGGRESSIVE (10ms)" : "LIGHT (3s)"}`)
}

/**
 * 최상위 유지 중지
 */
function stopTopmostKeeper() {
  if (aggressiveCheckInterval) {
    clearInterval(aggressiveCheckInterval)
    aggressiveCheckInterval = null
  }
}

/**
 * 오버레이 버튼 창 생성 (Property1, Property2 전용)
 */
function createOverlayButton() {
  console.log("[v0] createOverlayButton called")

  if (overlayButton) {
    overlayButton.close()
  }

  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenWidth, height: screenHeight } = primaryDisplay.bounds
  const buttonWidth = 220
  const buttonHeight = 100
  const centerX = Math.floor((screenWidth - buttonWidth) / 2)
  const centerY = Math.floor((screenHeight - buttonHeight) / 2)

  overlayButton = new BrowserWindow({
    width: buttonWidth,
    height: buttonHeight,
    x: centerX, // Center horizontally
    y: centerY, // Center vertically
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: true,
    type: "toolbar",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  overlayButton.loadFile(path.join(__dirname, "overlay-button.html"))

  overlayButton.webContents.on("did-finish-load", () => {
    console.log("[v0] Overlay button page loaded")
    keepOnTopAggressive(overlayButton)
  })

  if (process.env.NODE_ENV !== "production") {
    overlayButton.webContents.openDevTools({ mode: "detach" })
  }

  overlayButton.setIgnoreMouseEvents(false)

  startTopmostKeeper(overlayButton)

  console.log(`[v0] Overlay button created with ${AGGRESSIVE_MODE ? "AGGRESSIVE" : "LIGHT"} mode`)

  return overlayButton
}

/**
 * 키오스크 팝업 창 생성
 */
function createKioskPopup() {
  console.log("[v0] createKioskPopup called")

  if (kioskPopup) {
    kioskPopup.close()
  }

  kioskPopup = new BrowserWindow({
    width: 1920,
    height: 1080,
    frame: false,
    alwaysOnTop: true,
    fullscreen: true,
    focusable: true,
    type: "toolbar",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  const isDev = process.env.NODE_ENV !== "production"
  const startUrl = isDev
    ? "http://localhost:3000?mode=kiosk&popup=true"
    : `file://${path.join(__dirname, "../.next/server/app/index.html")}?mode=kiosk&popup=true`

  console.log("[v0] Loading popup URL:", startUrl)
  kioskPopup.loadURL(startUrl)

  kioskPopup.webContents.on("did-finish-load", () => {
    keepOnTopAggressive(kioskPopup)
    startTopmostKeeper(kioskPopup)
  })

  kioskPopup.on("closed", () => {
    stopTopmostKeeper()
    kioskPopup = null
    if (overlayButton) {
      overlayButton.show()
      keepOnTopAggressive(overlayButton)
      startTopmostKeeper(overlayButton)
    }
    console.log("[v0] Kiosk popup closed")
  })

  console.log("[v0] Kiosk popup created with lightweight topmost")

  return kioskPopup
}

/**
 * PMS 프로그램으로 포커스 복구
 */
function restorePMSFocus() {
  const pmsWindowTitle = process.env.PMS_WINDOW_TITLE || "PMS"

  console.log(`[v0] Attempting to restore focus to: ${pmsWindowTitle}`)

  stopTopmostKeeper()

  const command = `powershell -command "(New-Object -ComObject WScript.Shell).AppActivate('${pmsWindowTitle}')"`

  exec(command, (error) => {
    if (error) {
      console.error("[v0] Failed to restore PMS focus:", error)
      exec("powershell -command '(New-Object -ComObject Shell.Application).MinimizeAll()'", () => {
        console.log("[v0] Minimized all windows as fallback")
      })
    } else {
      console.log("[v0] Successfully restored PMS focus")
    }

    if (overlayButton) {
      setTimeout(() => {
        startTopmostKeeper(overlayButton)
      }, 1000)
    }
  })
}

// IPC 핸들러 등록
console.log("[v0] Registering overlay button IPC handlers")

ipcMain.on("overlay-button-clicked", () => {
  console.log("[v0] IPC: overlay-button-clicked received")

  stopTopmostKeeper()

  if (overlayButton) {
    overlayButton.hide()
    console.log("[v0] Overlay button hidden")
  }

  createKioskPopup()
})

ipcMain.on("checkin-complete", () => {
  console.log("[v0] IPC: checkin-complete received, preparing to close popup")

  setTimeout(() => {
    if (kioskPopup) {
      kioskPopup.close()
    }

    restorePMSFocus()

    if (overlayButton) {
      overlayButton.show()
    }
  }, 5000)
})

ipcMain.on("close-popup", () => {
  console.log("[v0] IPC: close-popup received")

  if (kioskPopup) {
    kioskPopup.close()
  }

  restorePMSFocus()

  if (overlayButton) {
    overlayButton.show()
  }
})

module.exports = {
  createOverlayButton,
  createKioskPopup,
  restorePMSFocus,
}

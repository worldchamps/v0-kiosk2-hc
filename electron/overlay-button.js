const { app, BrowserWindow, ipcMain, screen } = require("electron")
const fs = require("node:fs")
const path = require("path")
const { exec } = require("child_process")

let overlayButton = null
let kioskPopup = null
let aggressiveCheckInterval = null

function logPopup(message) {
  const line = `[${new Date().toISOString()}] ${message}`
  console.log(line)
  try { fs.appendFileSync(path.join(app.getPath("userData"), "overlay-popup.log"), line + "\n", { mode: 0o600 }) }
  catch (error) { console.error("[OVERLAY_POPUP] diagnostic log unavailable:", error.message) }
}

const AGGRESSIVE_MODE = process.env.AGGRESSIVE_TOPMOST === "true"
const CHECK_INTERVAL = 10 // 타사 키오스크의 최상위 창 재설정보다 자주 복구

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
 * 두 모드 모두 10ms마다 최상위 창을 복구한다.
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

  console.log(`[v0] Topmost keeper started: ${AGGRESSIVE_MODE ? "AGGRESSIVE" : "LIGHT"} (10ms)`)
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
  const buttonWidth = 200
  const buttonHeight = 125
  const topLeftX = 9 // 9px from left edge
  const topLeftY = 14 // 14px from top edge

  overlayButton = new BrowserWindow({
    width: buttonWidth,
    height: buttonHeight,
    x: topLeftX, // Top-left positioning
    y: topLeftY, // Top-left positioning
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
      autoplayPolicy: "no-user-gesture-required", // Allow autoplay for audio without user gesture
    },
  })

  overlayButton.loadFile(path.join(__dirname, "overlay-button.html"))

  overlayButton.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; " +
          "script-src 'self' 'unsafe-inline'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data:;",
        ],
      },
    })
  })

  overlayButton.webContents.on("did-finish-load", () => {
    console.log("[v0] Overlay button page loaded")
    overlayButton.webContents.send("kiosk:overlay-idle", true)
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

  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenWidth, height: screenHeight } = primaryDisplay.bounds
  const popupWidth = Math.round(screenWidth * 1.0)
  const popupHeight = Math.round(screenHeight * 1.0)
  const popupX = Math.round((screenWidth - popupWidth) / 2)
  const popupY = Math.round((screenHeight - popupHeight) / 2)

  console.log(
    `[v0] Screen: ${screenWidth}x${screenHeight}, Popup: ${popupWidth}x${popupHeight} at (${popupX}, ${popupY})`,
  )

  kioskPopup = new BrowserWindow({
    width: popupWidth,
    height: popupHeight,
    x: popupX,
    y: popupY,
    frame: false,
    alwaysOnTop: true,
    fullscreen: false,
    focusable: true,
    type: "toolbar",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      autoplayPolicy: "no-user-gesture-required",
      zoomFactor: 0.7,
    },
  })

  kioskPopup.webContents.on("did-finish-load", () => {
    kioskPopup.webContents.setZoomFactor(0.7)
    keepOnTopAggressive(kioskPopup)
    startTopmostKeeper(kioskPopup)
  })

  kioskPopup.webContents.session.webRequest.onHeadersReceived((details, callback) => {
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
          "media-src 'self' https://jdpd8txarrh2yidl.public.blob.vercel-storage.com https://*.blob.vercel-storage.com blob: data:; " +
          "frame-src 'self';",
        ],
      },
    })
  })

  const startUrl = "http://localhost:3000?mode=kiosk&popup=true&direct=reservationConfirm"

  logPopup(`[OVERLAY_POPUP] loading ${startUrl}`)
  kioskPopup.webContents.on("did-finish-load", () => logPopup("[OVERLAY_POPUP] page loaded"))
  kioskPopup.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== -3) logPopup(`[OVERLAY_POPUP] load failed: ${code} ${description} ${url}`)
  })
  kioskPopup.webContents.on("render-process-gone", (_event, details) => {
    logPopup(`[OVERLAY_POPUP] renderer stopped: ${details.reason}`)
  })
  kioskPopup.webContents.on("console-message", (_event, level, message) => {
    if (level >= 3) logPopup(`[OVERLAY_POPUP] script error: ${String(message).replace(/https?:\/\/\S+/g, "[URL]").slice(0, 300)}`)
  })
  kioskPopup.loadURL(startUrl).catch(error => logPopup(`[OVERLAY_POPUP] loadURL failed: ${error.message}`))

  kioskPopup.on("closed", () => {
    stopTopmostKeeper()
    kioskPopup = null
    if (overlayButton) {
      overlayButton.show()
      overlayButton.webContents.send("kiosk:overlay-idle", true)
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
    overlayButton.webContents.send("kiosk:overlay-idle", false)
    overlayButton.hide()
    console.log("[v0] Overlay button hidden")
  }

  createKioskPopup()
})

ipcMain.on("checkin-complete", () => {
  console.log("[v0] IPC: checkin-complete received, closing popup immediately")

  if (kioskPopup) {
    kioskPopup.close()
  }

  restorePMSFocus()

  if (overlayButton) {
    overlayButton.show()
  }
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
  isIdleButtonSender: sender => !!overlayButton && !overlayButton.isDestroyed() &&
    overlayButton.isVisible() && !kioskPopup && overlayButton.webContents === sender,
}

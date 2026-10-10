const { app, BrowserWindow, ipcMain, screen } = require("electron")
const fs = require("node:fs")
const path = require("path")

let overlayButton = null
let kioskPopup = null
let aggressiveCheckInterval = null

function logPopup(message) {
  const line = `[${new Date().toISOString()}] ${message}`
  console.log(line)
  try { fs.appendFileSync(path.join(app.getPath("userData"), "overlay-popup.log"), line + "\n", { mode: 0o600 }) }
  catch (error) { console.error("[OVERLAY_POPUP] diagnostic log unavailable:", error.message) }
}

const CHECK_INTERVAL = 250

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
  // Keep the button visible without taking input focus from the third-party kiosk.
}

/**
 * 최상위 유지 시작
 * 타사 프로그램의 입력 포커스를 바꾸지 않고 표시 순서만 복구한다.
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
  const { x, y, width, height } = primaryDisplay.bounds
  const kariv = process.env.KIOSK_PROPERTY_ID === "property2"
  const inset = Math.round(height * 0.01)
  // Kariv's room tabs start below the top 14% of the supplied screen.
  const bounds = kariv
    ? { x: x + inset, y: y + inset, width: width - inset * 2, height: Math.floor(height * 0.12) }
    : { x: x + 9, y: y + 14, width: 200, height: 125 }

  overlayButton = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: false,
    show: false,
    type: "toolbar",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      autoplayPolicy: "no-user-gesture-required", // Allow autoplay for audio without user gesture
    },
  })

  overlayButton.loadFile(path.join(__dirname, "overlay-button.html"), { query: { layout: kariv ? "banner" : "compact" } })

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
    overlayButton.showInactive()
    keepOnTopAggressive(overlayButton)
  })

  if (process.env.NODE_ENV !== "production") {
    overlayButton.webContents.openDevTools({ mode: "detach" })
  }

  overlayButton.setIgnoreMouseEvents(false)

  startTopmostKeeper(overlayButton)


  return overlayButton
}

/**
 * 키오스크 팝업 창 생성
 */
function createKioskPopup() {
  console.log("[v0] createKioskPopup called")

  if (kioskPopup && !kioskPopup.isDestroyed()) return kioskPopup

  const primaryDisplay = screen.getPrimaryDisplay()
  const { x, y, width: screenWidth, height: screenHeight } = primaryDisplay.bounds
  const popupWidth = Math.round(screenWidth * 1.0)
  const popupHeight = Math.round(screenHeight * 1.0)
  const popupX = x
  const popupY = y

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
    kioskPopup.focus()
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
      overlayButton.showInactive()
      overlayButton.webContents.send("kiosk:overlay-idle", true)
      keepOnTopAggressive(overlayButton)
      startTopmostKeeper(overlayButton)
    }
    console.log("[v0] Kiosk popup closed")
  })

  console.log("[v0] Kiosk popup created with lightweight topmost")

  return kioskPopup
}

function isWindowEvent(event, window) {
  return !!window && !window.isDestroyed() && event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame
}

// IPC 핸들러 등록
console.log("[v0] Registering overlay button IPC handlers")

ipcMain.on("overlay-button-clicked", event => {
  if (!isWindowEvent(event, overlayButton) || !overlayButton.isVisible() || kioskPopup || global.kioskMaintenance) return
  console.log("[v0] IPC: overlay-button-clicked received")

  stopTopmostKeeper()

  if (overlayButton) {
    overlayButton.webContents.send("kiosk:overlay-idle", false)
    overlayButton.hide()
    console.log("[v0] Overlay button hidden")
  }

  createKioskPopup()
})

for (const channel of ["checkin-complete", "close-popup"]) {
  ipcMain.on(channel, event => {
    if (isWindowEvent(event, kioskPopup)) kioskPopup.close()
  })
}

module.exports = {
  createOverlayButton,
  createKioskPopup,
  isIdleButtonSender: sender => !!overlayButton && !overlayButton.isDestroyed() &&
    overlayButton.isVisible() && !kioskPopup && overlayButton.webContents === sender,
}

const { BrowserWindow, ipcMain } = require("electron")
const path = require("path")
const { exec } = require("child_process")
const ref = require("ref-napi") // Declare the variable before using it

let overlayButton = null
let kioskPopup = null
let lightCheckInterval = null

let user32 = null
let SetWindowPos = null

try {
  const ffi = require("ffi-napi")

  user32 = ffi.Library("user32", {
    SetWindowPos: ["bool", ["pointer", "pointer", "int", "int", "int", "int", "uint"]],
    SetForegroundWindow: ["bool", ["pointer"]],
  })

  SetWindowPos = user32.SetWindowPos
  console.log("[v0] FFI loaded successfully - using native Windows API")
} catch (error) {
  console.warn("[v0] FFI not available, will use fallback methods:", error.message)
}

/**
 * Windows API를 직접 호출하여 최상위 설정 (한 번만 호출, 매우 효율적)
 */
function setWindowTopmostNative(window) {
  if (!window || window.isDestroyed()) return false

  try {
    const hwnd = window.getNativeWindowHandle()
    if (!hwnd || !SetWindowPos) return false

    const HWND_TOPMOST = ref.alloc("pointer", -1)
    const SWP_NOMOVE = 0x0002
    const SWP_NOSIZE = 0x0001
    const SWP_SHOWWINDOW = 0x0040

    const result = SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW)

    console.log("[v0] Native SetWindowPos called, result:", result)
    return result
  } catch (error) {
    console.error("[v0] Native SetWindowPos failed:", error)
    return false
  }
}

/**
 * Electron 내장 메서드로 최상위 유지 (가벼운 대체 방법)
 */
function keepOnTopLight(window) {
  if (!window || window.isDestroyed()) return

  window.setAlwaysOnTop(true, "screen-saver", 1)
  window.moveTop()
}

/**
 * 최상위 유지 시작 (FFI 사용 시 매우 가벼움)
 */
function startTopmostKeeper(window) {
  stopTopmostKeeper()

  // FFI 사용 가능하면 한 번만 호출
  if (SetWindowPos) {
    setWindowTopmostNative(window)

    // 5초마다 한 번씩만 확인 (매우 가벼움)
    lightCheckInterval = setInterval(() => {
      if (window && !window.isDestroyed()) {
        keepOnTopLight(window)
      }
    }, 5000)

    console.log("[v0] Using FFI native method (very efficient, 5s check)")
  } else {
    // FFI 없으면 Electron 메서드만 사용 (1초마다)
    lightCheckInterval = setInterval(() => {
      if (window && !window.isDestroyed()) {
        keepOnTopLight(window)
      }
    }, 1000)

    console.log("[v0] Using Electron fallback method (1s check)")
  }
}

/**
 * 최상위 유지 중지
 */
function stopTopmostKeeper() {
  if (lightCheckInterval) {
    clearInterval(lightCheckInterval)
    lightCheckInterval = null
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

  overlayButton = new BrowserWindow({
    width: 220,
    height: 100,
    x: 1680,
    y: 30,
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
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  overlayButton.loadFile(path.join(__dirname, "overlay-button.html"))

  overlayButton.webContents.on("did-finish-load", () => {
    console.log("[v0] Overlay button page loaded")
    if (SetWindowPos) {
      setWindowTopmostNative(overlayButton)
    } else {
      keepOnTopLight(overlayButton)
    }
  })

  if (process.env.NODE_ENV !== "production") {
    overlayButton.webContents.openDevTools({ mode: "detach" })
  }

  overlayButton.setIgnoreMouseEvents(false)

  startTopmostKeeper(overlayButton)

  console.log("[v0] Overlay button created with efficient topmost")

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
    if (SetWindowPos) {
      setWindowTopmostNative(kioskPopup)
    } else {
      keepOnTopLight(kioskPopup)
    }
    startTopmostKeeper(kioskPopup)
  })

  kioskPopup.on("closed", () => {
    stopTopmostKeeper()
    kioskPopup = null
    if (overlayButton) {
      overlayButton.show()
      if (SetWindowPos) {
        setWindowTopmostNative(overlayButton)
      } else {
        keepOnTopLight(overlayButton)
      }
      startTopmostKeeper(overlayButton)
    }
    console.log("[v0] Kiosk popup closed")
  })

  console.log("[v0] Kiosk popup created with efficient topmost")

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

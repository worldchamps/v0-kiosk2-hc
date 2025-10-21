const { BrowserWindow, ipcMain } = require("electron")
const path = require("path")

let overlayButton = null
let kioskPopup = null
let topmostInterval = null

/**
 * Windows API를 사용하여 강제로 최상위 유지
 */
function forceWindowToTop(window) {
  if (!window) return

  const { exec } = require("child_process")

  // Electron 내장 메서드
  window.setAlwaysOnTop(true, "screen-saver", 1)
  window.moveTop()
  window.focus()

  // Windows API를 통한 강제 최상위 설정
  // HWND_TOPMOST = -1
  const hwnd = window.getNativeWindowHandle()
  if (hwnd) {
    const hwndBuffer = hwnd.readInt32LE(0)
    const command = `powershell -command "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class Win32 { [DllImport(\\"user32.dll\\")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags); }'; [Win32]::SetWindowPos(${hwndBuffer}, -1, 0, 0, 0, 0, 0x0003)"`

    exec(command, (error) => {
      if (error) {
        console.error("[v0] Failed to force window topmost:", error)
      } else {
        console.log("[v0] Successfully forced window to topmost")
      }
    })
  }
}

/**
 * 주기적으로 최상위 유지 (100ms마다)
 */
function startTopmostKeeper(window) {
  if (topmostInterval) {
    clearInterval(topmostInterval)
  }

  topmostInterval = setInterval(() => {
    if (window && !window.isDestroyed()) {
      forceWindowToTop(window)
    }
  }, 100)

  console.log("[v0] Started topmost keeper interval")
}

/**
 * 최상위 유지 중지
 */
function stopTopmostKeeper() {
  if (topmostInterval) {
    clearInterval(topmostInterval)
    topmostInterval = null
    console.log("[v0] Stopped topmost keeper interval")
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
    focusable: true, // 포커스 가능하도록 설정
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  overlayButton.loadFile(path.join(__dirname, "overlay-button.html"))

  overlayButton.webContents.on("did-finish-load", () => {
    console.log("[v0] Overlay button page loaded")
    forceWindowToTop(overlayButton)
  })

  overlayButton.webContents.openDevTools({ mode: "detach" })

  overlayButton.setIgnoreMouseEvents(false)

  forceWindowToTop(overlayButton)

  startTopmostKeeper(overlayButton)

  console.log("[v0] Overlay button created with aggressive topmost")

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
    focusable: true, // 포커스 가능하도록 설정
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
    forceWindowToTop(kioskPopup)
    startTopmostKeeper(kioskPopup)
  })

  kioskPopup.on("closed", () => {
    stopTopmostKeeper() // 팝업 닫힐 때 타이머 정리
    kioskPopup = null
    if (overlayButton) {
      overlayButton.show()
      forceWindowToTop(overlayButton)
      startTopmostKeeper(overlayButton)
    }
    console.log("[v0] Kiosk popup closed")
  })

  console.log("[v0] Kiosk popup created with aggressive topmost")

  return kioskPopup
}

/**
 * PMS 프로그램으로 포커스 복구
 */
function restorePMSFocus() {
  const { exec } = require("child_process")
  const pmsWindowTitle = process.env.PMS_WINDOW_TITLE || "PMS"

  console.log(`[v0] Attempting to restore focus to: ${pmsWindowTitle}`)

  stopTopmostKeeper()

  const command = `powershell -command "(New-Object -ComObject WScript.Shell).AppActivate('${pmsWindowTitle}')"`

  exec(command, (error, stdout, stderr) => {
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

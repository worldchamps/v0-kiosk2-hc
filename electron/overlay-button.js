const { BrowserWindow, ipcMain } = require("electron")
const path = require("path")

let overlayButton = null
let kioskPopup = null

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
    x: 1680, // 화면 우측 상단
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
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // 오버레이 버튼 HTML 로드
  overlayButton.loadFile(path.join(__dirname, "overlay-button.html"))

  overlayButton.webContents.on("did-finish-load", () => {
    console.log("[v0] Overlay button page loaded")
  })

  overlayButton.webContents.openDevTools({ mode: "detach" })

  // 마우스 이벤트 허용
  overlayButton.setIgnoreMouseEvents(false)

  // 항상 최상위 유지
  overlayButton.setAlwaysOnTop(true, "screen-saver", 1)

  console.log("[v0] Overlay button created")

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
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // 팝업 모드로 웹앱 로드
  const isDev = process.env.NODE_ENV !== "production"
  const startUrl = isDev
    ? "http://localhost:3000?mode=kiosk&popup=true"
    : `file://${path.join(__dirname, "../.next/server/app/index.html")}?mode=kiosk&popup=true`

  console.log("[v0] Loading popup URL:", startUrl)
  kioskPopup.loadURL(startUrl)

  // 팝업이 닫히면 오버레이 버튼 다시 표시
  kioskPopup.on("closed", () => {
    kioskPopup = null
    if (overlayButton) {
      overlayButton.show()
    }
    console.log("[v0] Kiosk popup closed")
  })

  console.log("[v0] Kiosk popup created")

  return kioskPopup
}

/**
 * PMS 프로그램으로 포커스 복구
 */
function restorePMSFocus() {
  const { exec } = require("child_process")
  const pmsWindowTitle = process.env.PMS_WINDOW_TITLE || "PMS"

  console.log(`[v0] Attempting to restore focus to: ${pmsWindowTitle}`)

  // Windows PowerShell을 사용하여 PMS 프로그램에 포커스
  const command = `powershell -command "(New-Object -ComObject WScript.Shell).AppActivate('${pmsWindowTitle}')"`

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error("[v0] Failed to restore PMS focus:", error)
      // 실패 시 대체 방법: 모든 창 최소화 후 PMS 활성화
      exec("powershell -command '(New-Object -ComObject Shell.Application).MinimizeAll()'", () => {
        console.log("[v0] Minimized all windows as fallback")
      })
    } else {
      console.log("[v0] Successfully restored PMS focus")
    }
  })
}

console.log("[v0] Registering overlay button IPC handlers")

// IPC 핸들러: 오버레이 버튼 클릭
ipcMain.on("overlay-button-clicked", () => {
  console.log("[v0] IPC: overlay-button-clicked received")

  // 오버레이 버튼 숨기기
  if (overlayButton) {
    overlayButton.hide()
    console.log("[v0] Overlay button hidden")
  }

  // 키오스크 팝업 열기
  createKioskPopup()
})

// IPC 핸들러: 체크인 완료
ipcMain.on("checkin-complete", () => {
  console.log("[v0] IPC: checkin-complete received, preparing to close popup")

  // 5초 후 팝업 닫기 및 포커스 복구
  setTimeout(() => {
    if (kioskPopup) {
      kioskPopup.close()
    }

    // PMS 프로그램으로 포커스 복구
    restorePMSFocus()

    // 오버레이 버튼 다시 표시
    if (overlayButton) {
      overlayButton.show()
    }
  }, 5000)
})

// IPC 핸들러: 팝업 즉시 닫기
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

# 오버레이 버튼 시스템 (Property1, Property2 전용)

## 개요

Property1과 Property2 키오스크에서는 기존 EXE 키오스크 프로그램 위에 최상위 창(always-on-top) 버튼을 띄워서 웹 키오스크 앱을 팝업으로 실행합니다.

## 시스템 아키텍처

\`\`\`
┌─────────────────────────────────────┐
│  기존 EXE 키오스크 프로그램          │
│  (Property1/2 전용 PMS 소프트웨어)   │
│                                     │
│  ┌──────────────────────┐          │
│  │ 최상위 오버레이 버튼  │ ← Electron │
│  │ "예약 확인"          │          │
│  └──────────────────────┘          │
│                                     │
└─────────────────────────────────────┘
         ↓ 클릭 시
┌─────────────────────────────────────┐
│  팝업 창 (웹 키오스크 앱)            │
│  - 예약 확인 화면                   │
│  - 체크인 프로세스                  │
│  - 영수증 출력                      │
└─────────────────────────────────────┘
         ↓ 체크인 완료 시
┌─────────────────────────────────────┐
│  기존 EXE 키오스크로 포커스 복구     │
│  (자동으로 원래 화면으로 돌아감)     │
└─────────────────────────────────────┘
\`\`\`

## Property 감지 로직

### 객실 번호 기반 Property 판별

\`\`\`typescript
function getPropertyFromRoomNumber(roomNumber: string): string {
  if (!roomNumber) return "unknown"
  
  const upper = roomNumber.toUpperCase()
  
  // Property1: C###, D### 형식
  if (upper.startsWith("C") || upper.startsWith("D")) {
    return "property1"
  }
  
  // Property2: Kariv### 형식
  if (upper.startsWith("KARIV")) {
    return "property2"
  }
  
  // Property3: A###, B### 형식
  if (upper.startsWith("A") || upper.startsWith("B")) {
    return "property3"
  }
  
  // Property4: Camp### 형식
  if (upper.startsWith("CAMP")) {
    return "property4"
  }
  
  return "property3" // 기본값
}
\`\`\`

### 환경변수 기반 Property 설정

\`\`\`env
# .env.local
KIOSK_PROPERTY=property1  # property1, property2, property3, property4
OVERLAY_MODE=true         # true면 오버레이 버튼 모드 활성화
\`\`\`

## Electron 구현

### 1. 오버레이 버튼 창 (overlay-button.js)

\`\`\`javascript
const { BrowserWindow } = require('electron')
const path = require('path')
const ffi = require('ffi-napi')
const ref = require('ref-napi')

let user32 = null
let SetWindowPos = null

// FFI 초기화 (Visual Studio C++ 빌드 도구 필요)
try {
  user32 = ffi.Library('user32', {
    SetWindowPos: ['bool', ['pointer', 'pointer', 'int', 'int', 'int', 'int', 'uint']],
    SetForegroundWindow: ['bool', ['pointer']]
  })
  SetWindowPos = user32.SetWindowPos
  console.log('[v0] FFI loaded - using native Windows API')
} catch (error) {
  console.warn('[v0] FFI not available, using fallback:', error.message)
}

// Windows API를 직접 호출하여 최상위 설정 (한 번만 호출, 매우 효율적)
function setWindowTopmostNative(window) {
  if (!window || window.isDestroyed() || !SetWindowPos) return false
  
  try {
    const hwnd = window.getNativeWindowHandle()
    const HWND_TOPMOST = ref.alloc('pointer', -1)
    const SWP_NOMOVE = 0x0002
    const SWP_NOSIZE = 0x0001
    const SWP_SHOWWINDOW = 0x0040
    
    const result = SetWindowPos(
      hwnd, 
      HWND_TOPMOST, 
      0, 0, 0, 0, 
      SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW
    )
    
    console.log('[v0] Native SetWindowPos called, result:', result)
    return result
  } catch (error) {
    console.error('[v0] Native SetWindowPos failed:', error)
    return false
  }
}

// Electron 내장 메서드 (가벼운 대체 방법)
function keepOnTopLight(window) {
  if (!window || window.isDestroyed()) return
  window.setAlwaysOnTop(true, 'screen-saver', 1)
  window.moveTop()
}

// 최상위 유지 시작 (FFI 사용 시 매우 가벼움)
function startTopmostKeeper(window) {
  stopTopmostKeeper()
  
  if (SetWindowPos) {
    // FFI 사용: 한 번만 호출 + 5초마다 가벼운 확인
    setWindowTopmostNative(window)
    
    lightCheckInterval = setInterval(() => {
      if (window && !window.isDestroyed()) {
        keepOnTopLight(window)
      }
    }, 5000) // 5초마다 (매우 가벼움)
    
    console.log('[v0] Using FFI native method (very efficient, 5s check)')
  } else {
    // FFI 없음: Electron 메서드만 사용 (1초마다)
    lightCheckInterval = setInterval(() => {
      if (window && !window.isDestroyed()) {
        keepOnTopLight(window)
      }
    }, 1000)
    
    console.log('[v0] Using Electron fallback method (1s check)')
  }
}

function createOverlayButton() {
  const button = new BrowserWindow({
    width: 220,
    height: 100,
    x: 1680,
    y: 30,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })
  
  button.loadFile('overlay-button.html')
  button.setIgnoreMouseEvents(false)
  
  // FFI 네이티브 방식으로 최상위 설정
  if (SetWindowPos) {
    setWindowTopmostNative(button)
  } else {
    keepOnTopLight(button)
  }
  
  startTopmostKeeper(button)
  
  return button
}
\`\`\`

### 2. 팝업 키오스크 창

\`\`\`javascript
function createKioskPopup() {
  const popup = new BrowserWindow({
    width: 1920,
    height: 1080,
    frame: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  })
  
  popup.loadURL('http://localhost:3000?mode=kiosk&popup=true')
  
  return popup
}
\`\`\`

### 3. 포커스 복구 로직

\`\`\`javascript
const { exec } = require('child_process')

function restorePMSFocus() {
  // Windows에서 특정 프로그램에 포커스 복구
  // PMS 프로그램의 창 제목이나 프로세스 이름으로 찾기
  exec('powershell -command "(New-Object -ComObject WScript.Shell).AppActivate(\'PMS Program\')"', 
    (error, stdout, stderr) => {
      if (error) {
        console.error('포커스 복구 실패:', error)
      }
    }
  )
}
\`\`\`

## 웹앱 통합

### URL 파라미터로 모드 감지

\`\`\`typescript
// app/page.tsx
const searchParams = useSearchParams()
const isPopupMode = searchParams.get('popup') === 'true'

if (isPopupMode) {
  // 팝업 모드: 예약 확인 화면으로 바로 이동
  router.push('/kiosk/reservation-confirm')
}
\`\`\`

### 체크인 완료 시 창 닫기 및 포커스 복구

\`\`\`typescript
// components/check-in-complete.tsx
useEffect(() => {
  if (isPopupMode && checkInComplete) {
    // Electron IPC로 메시지 전송
    if (window.electron) {
      window.electron.send('checkin-complete')
    }
    
    // 5초 후 창 닫기
    setTimeout(() => {
      if (window.electron) {
        window.electron.send('close-popup')
      }
    }, 5000)
  }
}, [checkInComplete, isPopupMode])
\`\`\`

## 설정 파일

### electron-config.json

\`\`\`json
{
  "property1": {
    "overlayMode": true,
    "pmsWindowTitle": "Property1 PMS",
    "buttonPosition": { "x": 1700, "y": 20 }
  },
  "property2": {
    "overlayMode": true,
    "pmsWindowTitle": "Property2 PMS",
    "buttonPosition": { "x": 1700, "y": 20 }
  },
  "property3": {
    "overlayMode": false
  },
  "property4": {
    "overlayMode": false
  }
}
\`\`\`

## 실행 방법

### Visual Studio C++ 빌드 도구 설치 (필수)

FFI 네이티브 모듈을 사용하려면 Visual Studio C++ 빌드 도구가 필요합니다:

\`\`\`bash
# Visual Studio Installer에서 설치
# "Desktop development with C++" 워크로드 선택

# 또는 독립 실행형 빌드 도구 설치
# https://visualstudio.microsoft.com/downloads/
# "Build Tools for Visual Studio" 다운로드
\`\`\`

설치 후:

\`\`\`bash
npm install
\`\`\`

### Property1/2 키오스크

\`\`\`bash
# 개발 모드
npm run electron:overlay

# 프로덕션 모드
set KIOSK_PROPERTY=property1
set OVERLAY_MODE=true
npm run electron
\`\`\`

### Property3/4 키오스크 (기존 방식)

\`\`\`bash
# 일반 전체화면 모드
set KIOSK_PROPERTY=property3
set OVERLAY_MODE=false

npm run electron:start
\`\`\`

## 성능 최적화 (2GB RAM 환경)

### FFI 네이티브 방식 (권장)

- **메모리 사용량**: 매우 낮음 (5초마다 가벼운 확인만)
- **CPU 사용량**: 거의 없음 (Windows API 한 번 호출)
- **요구사항**: Visual Studio C++ 빌드 도구

### Electron 대체 방식 (FFI 없을 때)

- **메모리 사용량**: 낮음 (1초마다 Electron 메서드)
- **CPU 사용량**: 낮음 (네이티브 함수 호출)
- **요구사항**: 없음

### ~~PowerShell 방식 (사용 안 함)~~

- ❌ **메모리 사용량**: 높음 (프로세스 반복 생성)
- ❌ **CPU 사용량**: 높음 (2초마다 PowerShell 실행)
- ❌ **2GB RAM 환경에서 부적합**

## 보안 고려사항

1. **오버레이 버튼 보호**: 일반 사용자가 버튼을 이동하거나 닫을 수 없도록 설정
2. **PMS 프로그램 감지**: 실행 중인 PMS 프로그램을 자동으로 감지
3. **포커스 복구 실패 시**: 사용자에게 수동으로 PMS 화면으로 돌아가도록 안내

## 문제 해결

### FFI 설치 실패

\`\`\`
Error: Cannot find module 'ffi-napi'
\`\`\`

**해결 방법**:
1. Visual Studio C++ 빌드 도구 설치 확인
2. `npm install` 재실행
3. 실패 시 Electron 대체 방식으로 자동 전환 (성능은 약간 낮지만 작동함)

### 성능 문제 (CPU 사용량 증가)

**FFI 사용 시**: CPU 사용량 거의 없음 (5초마다 가벼운 확인)
**FFI 없을 시**: CPU 사용량 낮음 (1초마다 Electron 메서드)

2GB RAM 환경에서도 안정적으로 작동합니다.

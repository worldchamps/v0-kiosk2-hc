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

function createOverlayButton() {
  const button = new BrowserWindow({
    width: 200,
    height: 80,
    x: 1700,  // 화면 우측 상단
    y: 20,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })
  
  button.loadFile('overlay-button.html')
  button.setIgnoreMouseEvents(false)
  
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

### Property1/2 키오스크

\`\`\`bash
# 환경변수 설정
set KIOSK_PROPERTY=property1
set OVERLAY_MODE=true

# Electron 앱 실행
npm run electron:start
\`\`\`

### Property3/4 키오스크 (기존 방식)

\`\`\`bash
# 일반 전체화면 모드
set KIOSK_PROPERTY=property3
set OVERLAY_MODE=false

npm run electron:start
\`\`\`

## 보안 고려사항

1. **오버레이 버튼 보호**: 일반 사용자가 버튼을 이동하거나 닫을 수 없도록 설정
2. **PMS 프로그램 감지**: 실행 중인 PMS 프로그램을 자동으로 감지
3. **포커스 복구 실패 시**: 사용자에게 수동으로 PMS 화면으로 돌아가도록 안내

## 문제 해결

### 오버레이 버튼이 보이지 않음
- `alwaysOnTop: true` 설정 확인
- 화면 좌표가 모니터 범위 내에 있는지 확인

### 포커스 복구가 작동하지 않음
- PMS 프로그램의 정확한 창 제목 확인
- Windows PowerShell 권한 확인

### 팝업이 PMS 프로그램 뒤로 가는 경우
- `alwaysOnTop: true` 설정 확인
- z-index 우선순위 조정

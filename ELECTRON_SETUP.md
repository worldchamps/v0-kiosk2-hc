# Electron 키오스크 설정 가이드

## 1. 의존성 설치

\`\`\`bash
npm install
\`\`\`

이 명령어로 다음이 설치됩니다:
- Electron 런타임
- SerialPort (하드웨어 통신)
- Electron Builder (배포용)
- 개발 도구들

## 2. 개발 모드 실행

\`\`\`bash
npm run electron:dev
\`\`\`

이 명령어는:
1. Next.js 개발 서버를 시작합니다 (localhost:3000)
2. Electron 윈도우를 자동으로 엽니다
3. 하드웨어 자동 연결을 시도합니다

**주의**: 일반 컴퓨터에는 지폐 인식기/방출기가 없으므로 연결 실패 메시지가 나옵니다. 이는 정상입니다.

## 3. 시리얼 포트 설정

실제 키오스크에서 사용하기 전에 `electron/main.js` 파일에서 포트 설정을 변경해야 합니다:

\`\`\`javascript
const BILL_ACCEPTOR_CONFIG = {
  path: 'COM3', // ← 실제 포트로 변경
  baudRate: 9600,
  // ...
}

const BILL_DISPENSER_CONFIG = {
  path: 'COM4', // ← 실제 포트로 변경
  baudRate: 9600,
  // ...
}
\`\`\`

### 포트 확인 방법

Windows:
- 장치 관리자 → 포트(COM & LPT) 확인

또는 앱 내에서 관리자 모드로 "사용 가능한 포트 목록" 기능 사용

## 4. 프로덕션 빌드

\`\`\`bash
npm run electron:build
\`\`\`

결과물: `dist/TheBeachStay Kiosk Setup 1.0.0.exe`

## 5. 키오스크 모드 활성화

배포 전에 `electron/main.js`에서 다음을 변경:

\`\`\`javascript
function createWindow() {
  mainWindow = new BrowserWindow({
    fullscreen: true,
    kiosk: true,      // false → true
    frame: false,     // true → false
    // ...
  })
  
  // DevTools 비활성화
  // mainWindow.webContents.openDevTools() // 주석 처리
}
\`\`\`

## 6. 자동 재연결 기능

Electron 앱은 다음과 같이 자동으로 하드웨어를 관리합니다:

- **앱 시작 시**: 2초 후 자동 연결 시도
- **연결 실패 시**: 10초 후 재시도
- **연결 끊김 시**: 5초 후 자동 재연결

수동 재연결도 가능합니다 (관리자 화면에서).

## 7. 웹 브라우저와의 차이점

| 기능 | 웹 브라우저 | Electron |
|------|------------|----------|
| 하드웨어 연결 | 매번 수동 | 자동 |
| 재시작 후 | 재연결 필요 | 자동 재연결 |
| 전체화면 | F11 (해제 가능) | 고정 가능 |
| 업데이트 | 즉시 반영 | 재설치 필요 |

## 8. 문제 해결

### "포트를 열 수 없습니다" 에러
- 다른 프로그램이 포트를 사용 중일 수 있습니다
- 장치 관리자에서 포트 번호를 확인하세요
- USB 케이블을 다시 연결해보세요

### "모듈을 찾을 수 없습니다" 에러
\`\`\`bash
npm run postinstall
\`\`\`

### 화면이 나타나지 않음
- `electron/main.js`의 `startUrl` 확인
- 개발 모드: `http://localhost:3000`이 실행 중인지 확인

## 9. 배포 체크리스트

- [ ] 시리얼 포트 번호 설정 완료
- [ ] 키오스크 모드 활성화 (kiosk: true, frame: false)
- [ ] DevTools 비활성화
- [ ] 아이콘 파일 준비 (public/icon.ico)
- [ ] 프로덕션 빌드 테스트
- [ ] Windows 시작 프로그램 등록 (자동 실행)

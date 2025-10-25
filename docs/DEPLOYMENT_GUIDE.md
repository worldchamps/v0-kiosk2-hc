# 배포 가이드

## Property별 배포 전략

### Property1 & Property2 (오버레이 모드)

이 Property들은 기존 EXE 키오스크 프로그램 위에 오버레이 버튼을 표시합니다.

#### 1. 환경변수 설정

`.env.local` 파일 생성:

\`\`\`env
# Property1 예시
KIOSK_PROPERTY=property1
OVERLAY_MODE=true
PMS_WINDOW_TITLE=Property1 PMS

# Firebase 및 Google Sheets 설정
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_DATABASE_URL=https://your-project.firebaseio.com
# ... 나머지 환경변수
\`\`\`

#### 2. Electron 빌드

\`\`\`bash
npm run electron:build
\`\`\`

#### 3. 설치 및 실행

1. `dist/TheBeachStay Kiosk Setup 1.0.0.exe` 실행
2. 설치 완료 후 앱 실행
3. 오버레이 버튼이 화면 우측 상단에 표시됨
4. 기존 PMS 프로그램을 실행한 상태에서 사용

#### 4. 자동 시작 설정

Windows 시작 프로그램에 등록:

1. `Win + R` → `shell:startup`
2. TheBeachStay Kiosk 바로가기 복사
3. 재부팅 시 자동 실행됨

### Property3 & Property4 (전체화면 모드)

일반 키오스크 모드로 실행됩니다.

#### 1. 환경변수 설정

\`\`\`env
# Property3 예시
KIOSK_PROPERTY=property3
OVERLAY_MODE=false

# Firebase 및 Google Sheets 설정
FIREBASE_PROJECT_ID=your-project-id
# ... 나머지 환경변수
\`\`\`

#### 2. 키오스크 모드 활성화

`electron/main.js` 수정:

\`\`\`javascript
mainWindow = new BrowserWindow({
  fullscreen: true,
  kiosk: true,      // false → true
  frame: false,     // true → false
  // ...
})
\`\`\`

#### 3. 빌드 및 배포

\`\`\`bash
npm run electron:build
\`\`\`

## 웹 배포 (Vercel)

### 1. Vercel 환경변수 설정

v0 대시보드 → Vars 섹션에서 설정:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_DATABASE_URL`
- `GOOGLE_SHEETS_SPREADSHEET_ID`
- 기타 필요한 환경변수

### 2. 자동 배포

- v0에서 코드 변경 시 자동으로 Vercel에 배포됨
- GitHub 연동 시 push마다 자동 배포

### 3. 도메인 설정

Vercel 대시보드에서 커스텀 도메인 연결 가능

## PMS 리스너 설정

각 Property별로 PMS 리스너 스크립트 실행 필요:

### Property1

\`\`\`bash
cd C:\PMS\Property1
python pms_firebase_manager_property1.py
\`\`\`

### Property2

\`\`\`bash
cd C:\PMS\Property2
python pms_firebase_manager_property2.py
\`\`\`

### Property3 & Property4

해당 Property의 디렉토리에서 리스너 실행

## 문제 해결

### 오버레이 버튼이 보이지 않음

1. `OVERLAY_MODE=true` 확인
2. Electron 앱 재시작
3. 화면 해상도 확인 (1920x1080 권장)

### PMS 포커스 복구 실패

1. `PMS_WINDOW_TITLE` 환경변수 확인
2. PMS 프로그램의 정확한 창 제목 확인
3. Windows PowerShell 권한 확인

### 체크인 후 팝업이 닫히지 않음

1. Electron IPC 통신 확인
2. 브라우저 콘솔에서 에러 확인
3. `window.electronAPI` 존재 여부 확인

## 업데이트 절차

### Electron 앱 업데이트

1. 새 버전 빌드
2. 기존 앱 제거
3. 새 설치 파일 실행
4. 환경변수 재설정 (필요시)

### 웹 앱 업데이트

- v0에서 자동 배포됨
- 별도 작업 불필요

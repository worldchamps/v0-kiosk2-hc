# 빠른 시작 가이드

## Property 선택

먼저 어떤 Property를 설정할지 결정하세요:

- **Property1 (C동, D동)** - 오버레이 버튼 모드
- **Property2 (Kariv)** - 오버레이 버튼 모드  
- **Property3 (A동, B동)** - 전체화면 키오스크 모드
- **Property4 (Camp)** - 전체화면 키오스크 모드

> **오버레이 모드**: 기존 EXE 키오스크 프로그램 위에 버튼을 띄워서 사용  
> **전체화면 모드**: 독립적인 키오스크 앱으로 실행

---

## 1. Firebase 설정 (5분)

### Firebase 프로젝트 생성
1. [Firebase Console](https://console.firebase.google.com/) 접속
2. "프로젝트 추가" → 이름 입력 → 생성
3. Realtime Database 생성 (테스트 모드)
4. 데이터베이스 URL 복사

### 서비스 계정 키 다운로드
1. 프로젝트 설정 → 서비스 계정
2. "새 비공개 키 생성" → JSON 다운로드
3. 파일명: `firebase-service-account.json`

## 2. Vercel 환경 변수 설정 (3분)

v0 사이드바 → **Vars** 섹션에 추가:

\`\`\`
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@...
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
FIREBASE_DATABASE_URL=https://your-project.firebaseio.com
\`\`\`

## 3. 로컬 환경 설정 (10분)

### 환경변수 파일 생성

`.env.local.template`을 복사하여 `.env.local` 생성:

\`\`\`bash
copy .env.local.template .env.local
\`\`\`

### Property 설정

`.env.local` 파일에서 Property 설정:

**Property1 예시:**
\`\`\`env
KIOSK_PROPERTY=property1
OVERLAY_MODE=true
PMS_WINDOW_TITLE=Property1 PMS
\`\`\`

**Property3 예시:**
\`\`\`env
KIOSK_PROPERTY=property3
OVERLAY_MODE=false
\`\`\`

### Firebase 및 Google Sheets 설정

`.env.local`에 Firebase 정보 추가:

\`\`\`env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_DATABASE_URL=https://your-project.firebaseio.com
GOOGLE_SHEETS_SPREADSHEET_ID=your-sheet-id
# ... 나머지 환경변수
\`\`\`

## 4. 로컬 PMS 리스너 설정 (10분)

### Python 설치
1. [Python 다운로드](https://www.python.org/downloads/)
2. 설치 시 "Add to PATH" 체크

### Firebase SDK 설치
\`\`\`bash
pip install firebase-admin
\`\`\`

### Property별 리스너 실행

**Property1:**
\`\`\`bash
cd C:\PMS\Property1
python pms_firebase_manager_property1.py
\`\`\`

**Property2:**
\`\`\`bash
cd C:\PMS\Property2
python pms_firebase_manager_property2.py
\`\`\`

**Property3/4:**
해당 Property 디렉토리에서 리스너 실행

## 5. 개발 모드 실행

\`\`\`bash
npm install
npm run electron:dev
\`\`\`

### Property1/2 (오버레이 모드)
- 화면 우측 상단에 "예약 확인" 버튼 표시
- 버튼 클릭 시 팝업 창 열림
- 체크인 완료 후 자동으로 원래 프로그램으로 복귀

### Property3/4 (전체화면 모드)
- 전체화면 키오스크 앱 실행
- 일반적인 키오스크 플로우

## 6. 프로덕션 빌드

### Electron 앱 빌드

\`\`\`bash
npm run electron:build
\`\`\`

결과물: `dist/TheBeachStay Kiosk Setup 1.0.0.exe`

### 배포 전 체크리스트

**Property1/2 (오버레이 모드):**
- [ ] `OVERLAY_MODE=true` 설정
- [ ] `PMS_WINDOW_TITLE` 정확히 설정
- [ ] 기존 PMS 프로그램 실행 확인
- [ ] 오버레이 버튼 위치 확인

**Property3/4 (전체화면 모드):**
- [ ] `electron/main.js`에서 `kiosk: true`, `frame: false` 설정
- [ ] DevTools 비활성화
- [ ] 전체화면 모드 테스트

**공통:**
- [ ] Firebase 연결 테스트
- [ ] PMS 리스너 실행 확인
- [ ] 체크인 플로우 테스트
- [ ] 영수증 인쇄 테스트

## 7. 테스트

1. 키오스크에서 체크인
2. 리스너 콘솔 확인:
   \`\`\`
   [PMS Listener] 체크인 처리 시작: B521 (홍길동)
   [PMS Listener] ✓ 체크인 성공: B521
   \`\`\`
3. PMS 프로그램에서 객실 상태 확인

## 완료! 🎉

이제 키오스크 체크인이 실시간으로 PMS에 반영됩니다.

## 추가 문서

- 📘 [오버레이 버튼 시스템](OVERLAY_BUTTON_SYSTEM.md) - Property1/2 상세 가이드
- 🏨 [Property 설정](PROPERTY_CONFIGURATION.md) - Property별 설정
- 🚀 [배포 가이드](DEPLOYMENT_GUIDE.md) - 프로덕션 배포
- 🔧 [Electron 설정](../ELECTRON_SETUP.md) - 하드웨어 통합
- 🔥 [Firebase 설정](FIREBASE_SETUP.md) - Firebase 상세 가이드

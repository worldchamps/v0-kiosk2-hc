# 프로덕션 빌드 가이드

## 빌드 전 준비사항

### 1. 환경 변수 설정 (.env.local)

프로덕션 빌드에 포함될 환경 변수를 `.env.local` 파일에 설정하세요:

\`\`\`env
# Property 설정
KIOSK_PROPERTY=property3

# Firebase 설정
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-client-email
FIREBASE_PRIVATE_KEY=your-private-key
FIREBASE_DATABASE_URL=your-database-url
NEXT_PUBLIC_FIREBASE_DATABASE_URL=your-database-url
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id

# Google Sheets 설정
GOOGLE_SHEETS_CLIENT_EMAIL=your-client-email
GOOGLE_SHEETS_PRIVATE_KEY=your-private-key
GOOGLE_SHEETS_SPREADSHEET_ID=your-spreadsheet-id

# API 키 (서버 측 전용)
API_KEY=your-server-api-key
ADMIN_API_KEY=your-admin-api-key

# 프린터 설정
PRINTER_SIMPLE_MODE=true
FORCE_SIMPLE_FOR_BK3=true

# Vercel Blob
BLOB_READ_WRITE_TOKEN=your-blob-token
\`\`\`

**보안 참고**: 민감한 API 키는 서버 측 환경변수로만 설정하세요. 클라이언트에 노출되는 변수(`NEXT_PUBLIC_*`)에는 민감한 정보를 포함하지 마세요.

### 2. 오디오 파일 확인

`public/audio/` 폴더에 다음 파일들이 있는지 확인:
- reservation-prompt.mp3
- reservation-found.mp3
- reservation-not-found.mp3
- building-a-guide.mp3
- building-b-guide.mp3
- building-c-guide.mp3
- building-d-guide.mp3
- building-camp-guide.mp3
- idle-welcome.mp3
- bgm.mp3

없다면 다운로드:
\`\`\`bash
npm run download-audio
\`\`\`

## 빌드 실행

\`\`\`bash
# 1. Next.js 빌드
npm run build

# 2. Electron 앱 빌드
npm run electron:build
\`\`\`

## 빌드 결과

`dist/` 폴더에 다음 파일이 생성됩니다:
- `TheBeachStay Kiosk Setup 1.0.0.exe` - Windows 설치 파일

## Property별 빌드

각 Property마다 다른 환경 변수로 빌드:

\`\`\`bash
# Property1 (C/D동)
echo KIOSK_PROPERTY=property1 > .env.local
# ... 나머지 환경 변수 추가
npm run electron:build
# 생성된 파일 이름 변경: TheBeachStay-Property1.exe

# Property2 (Kariv)
echo KIOSK_PROPERTY=property2 > .env.local
npm run electron:build

# Property3 (A/B동)
echo KIOSK_PROPERTY=property3 > .env.local
npm run electron:build

# Property4 (캠프스테이)
echo KIOSK_PROPERTY=property4 > .env.local
npm run electron:build
\`\`\`

## 설치 및 배포

1. 생성된 `.exe` 파일을 키오스크 PC로 복사
2. 설치 프로그램 실행
3. 설치 완료 후 앱 실행
4. DevTools에서 에러 확인 (자동으로 열림)

## 문제 해결

### 흰 화면이 나타나는 경우

1. DevTools 콘솔에서 에러 확인
2. `.env.local` 파일이 제대로 로드되었는지 확인
3. Firebase/Google Sheets 연결 확인

### 서버 시작 실패

- 포트 3000이 이미 사용 중인지 확인
- 방화벽 설정 확인
- 로그 파일 확인

### 환경 변수가 로드되지 않는 경우

설치 후 앱 폴더에 `.env.local` 파일을 수동으로 복사:
\`\`\`
C:\Users\[사용자명]\AppData\Local\Programs\thebeachstay-kiosk\.env.local

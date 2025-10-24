# 환경변수 설정 가이드

## 로컬 개발 환경 설정

### 1. 환경변수 파일 생성

\`\`\`bash
# .env.local.template을 복사하여 .env.local 생성
copy .env.local.template .env.local
\`\`\`

### 2. v0/Vercel에서 환경변수 값 가져오기

1. **v0 웹사이트 접속**: https://v0.app
2. 현재 프로젝트 채팅 열기
3. 왼쪽 사이드바에서 **"Vars"** 클릭
4. 모든 환경변수 값 확인 및 복사

### 3. .env.local 파일에 값 입력

`.env.local` 파일을 텍스트 에디터로 열고 각 변수에 실제 값을 입력하세요.

#### 필수 환경변수 (Firebase)

\`\`\`env
FIREBASE_PROJECT_ID=your-actual-project-id
FIREBASE_DATABASE_URL=https://your-project.firebaseio.com
NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://your-project.firebaseio.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-actual-project-id
\`\`\`

**주의**: `FIREBASE_PRIVATE_KEY`는 여러 줄로 되어 있습니다. 다음과 같이 입력하세요:

\`\`\`env
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQ...\n-----END PRIVATE KEY-----\n"
\`\`\`

#### Google Sheets 환경변수

\`\`\`env
GOOGLE_SHEETS_CLIENT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_SHEETS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEETS_SPREADSHEET_ID=your-spreadsheet-id
\`\`\`

#### API Keys

\`\`\`env
API_KEY=your-server-api-key
ADMIN_API_KEY=your-admin-key
\`\`\`

**보안 참고**: API 키는 서버 측에서만 사용하세요. 클라이언트에 노출되는 환경변수는 `NEXT_PUBLIC_` prefix를 사용하지만, 민감한 정보는 포함하지 마세요.

### 4. 환경변수 확인

\`\`\`bash
# 앱 재시작
npm run electron:dev
\`\`\`

Firebase 에러가 사라지면 성공입니다!

## 환경변수 없이 테스트하기

Firebase나 Google Sheets 없이 UI만 테스트하려면:

1. `.env.local` 파일에 더미 값 입력:

\`\`\`env
FIREBASE_PROJECT_ID=test-project
FIREBASE_DATABASE_URL=https://test.firebaseio.com
NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://test.firebaseio.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=test-project
\`\`\`

2. Firebase 연결은 실패하지만 UI는 정상 작동합니다

## 보안 주의사항

⚠️ **절대로 .env.local 파일을 Git에 커밋하지 마세요!**

- `.gitignore`에 이미 추가되어 있습니다
- 환경변수에는 민감한 정보(API 키, 비밀키)가 포함되어 있습니다
- GitHub에 올라가면 보안 위험이 있습니다

## 문제 해결

### Firebase 에러가 계속 나는 경우

1. `.env.local` 파일이 프로젝트 루트에 있는지 확인
2. 환경변수 이름이 정확한지 확인 (대소문자 구분)
3. 앱을 완전히 종료하고 다시 시작
4. `NEXT_PUBLIC_` prefix가 있는 변수는 클라이언트에서 사용됩니다

### Private Key 형식 에러

Private Key는 반드시 따옴표로 감싸고 `\n`을 포함해야 합니다:

\`\`\`env
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_KEY_HERE\n-----END PRIVATE KEY-----\n"
\`\`\`

## 프로덕션 배포

Electron 앱을 빌드할 때는 환경변수가 앱에 포함됩니다. 
각 키오스크마다 다른 설정이 필요하면 설정 파일을 별도로 관리하세요.

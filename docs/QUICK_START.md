# 빠른 시작 가이드

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

## 3. 로컬 PMS 설정 (10분)

### Python 설치
1. [Python 다운로드](https://www.python.org/downloads/)
2. 설치 시 "Add to PATH" 체크

### Firebase SDK 설치
\`\`\`bash
pip install firebase-admin
\`\`\`

### 리스너 스크립트 설정
1. `scripts/pms_firebase_listener.py` 파일 수정:
   - `FIREBASE_CREDENTIALS_PATH`: 서비스 계정 키 경로
   - `FIREBASE_DATABASE_URL`: Firebase URL
   - `AHK_SCRIPT_PATH`: AutoHotkey 스크립트 경로

2. 실행:
\`\`\`bash
python pms_firebase_listener.py
\`\`\`

## 4. 테스트

1. 키오스크에서 체크인
2. 리스너 콘솔 확인:
   \`\`\`
   [PMS Listener] 체크인 처리 시작: B521 (홍길동)
   [PMS Listener] ✓ 체크인 성공: B521
   \`\`\`

## 완료! 🎉

이제 키오스크 체크인이 실시간으로 PMS에 반영됩니다.

상세 가이드: [FIREBASE_SETUP.md](FIREBASE_SETUP.md)
\`\`\`

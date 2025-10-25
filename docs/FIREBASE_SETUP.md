# Firebase PMS 통합 설정 가이드

## 개요

Firebase Realtime Database를 사용하여 키오스크 체크인 → 로컬 PMS 자동화를 실시간으로 처리합니다.

## 장점

- ✅ **실시간 알림**: 체크인 즉시 로컬 PMS에 전달 (지연 없음)
- ✅ **API 할당량 무제한**: Google Sheets API 제한 없음
- ✅ **무료**: Firebase 무료 플랜으로 충분
- ✅ **안정적**: 네트워크 재연결 자동 처리

---

## 1단계: Firebase 프로젝트 생성

### 1.1 Firebase Console 접속

1. [Firebase Console](https://console.firebase.google.com/) 접속
2. "프로젝트 추가" 클릭
3. 프로젝트 이름 입력 (예: "kiosk-pms")
4. Google Analytics 비활성화 (선택사항)
5. "프로젝트 만들기" 클릭

### 1.2 Realtime Database 생성

1. 왼쪽 메뉴에서 "Realtime Database" 선택
2. "데이터베이스 만들기" 클릭
3. 위치 선택: **asia-southeast1** (싱가포르 - 한국과 가장 가까움)
4. 보안 규칙: **테스트 모드로 시작** 선택
5. "사용 설정" 클릭

### 1.3 데이터베이스 URL 확인

- 생성된 데이터베이스 URL 복사 (예: `https://kiosk-pms-default-rtdb.asia-southeast1.firebasedatabase.app`)

---

## 2단계: 서비스 계정 키 생성

### 2.1 서비스 계정 키 다운로드

1. Firebase Console → 프로젝트 설정 (⚙️ 아이콘)
2. "서비스 계정" 탭 선택
3. "새 비공개 키 생성" 클릭
4. JSON 파일 다운로드
5. 파일명을 `firebase-service-account.json`으로 변경

### 2.2 환경 변수 설정 (Vercel)

v0 사이드바 → **Vars** 섹션에 다음 환경 변수 추가:

\`\`\`
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n
FIREBASE_DATABASE_URL=https://your-project.firebaseio.com
\`\`\`

**값 찾는 방법:**
- 다운로드한 `firebase-service-account.json` 파일 열기
- `project_id` → `FIREBASE_PROJECT_ID`
- `client_email` → `FIREBASE_CLIENT_EMAIL`
- `private_key` → `FIREBASE_PRIVATE_KEY` (줄바꿈 포함)
- 데이터베이스 URL → `FIREBASE_DATABASE_URL`

---

## 3단계: 로컬 PMS 컴퓨터 설정

### 3.1 Python 설치

1. [Python 3.9+](https://www.python.org/downloads/) 다운로드 및 설치
2. 설치 시 "Add Python to PATH" 체크

### 3.2 Firebase Admin SDK 설치

\`\`\`bash
pip install firebase-admin
\`\`\`

### 3.3 서비스 계정 키 배치

1. 다운로드한 `firebase-service-account.json` 파일을 로컬 PMS 컴퓨터에 복사
2. 경로 예시: `C:\PMS\firebase-service-account.json`

### 3.4 리스너 스크립트 설정

`pms_firebase_listener.py` 파일 수정:

\`\`\`python
# Firebase 설정 - 직접 타이핑하세요 (복사 붙여넣기 시 숨겨진 문자 포함될 수 있음)
FIREBASE_CREDENTIALS_PATH = r"C:\PMS\firebase-service-account.json"  # 실제 경로

# Firebase Console > Realtime Database > 데이터 탭에서 확인
# 예시: https://kiosk-pms-default-rtdb.asia-southeast1.firebasedatabase.app
FIREBASE_DATABASE_URL = "https://your-project-default-rtdb.firebaseio.com"  # 실제 URL로 변경

# AutoHotkey 경로
AHK_SCRIPT_PATH = r"C:\Users\USER\Documents\AutoHotkey\pms_automator.ahk"
AHK_EXE_PATH = r"C:\Program Files\AutoHotkey\AutoHotkey.exe"
ROOM_NUMBER_FILE = r"C:\Users\USER\Documents\AutoHotkey\room_number_data.tmp"
\`\`\`

**중요: Firebase Database URL 찾는 방법**

1. Firebase Console 접속: https://console.firebase.google.com
2. 프로젝트 선택
3. 왼쪽 메뉴 → **Realtime Database** 클릭
4. 상단의 **데이터** 탭 선택
5. URL 확인 (예: `https://xxx-default-rtdb.asia-southeast1.firebasedatabase.app`)
6. 이 URL을 스크립트의 `FIREBASE_DATABASE_URL`에 입력

### 3.5 리스너 실행

\`\`\`bash
python pms_firebase_listener.py
\`\`\`

**출력 예시:**
\`\`\`
============================================================
PMS Firebase Listener 시작
============================================================
[PMS Listener] ✓ Firebase 연결 성공!
[PMS Listener] 인증 파일: C:\PMS\firebase-service-account.json
[PMS Listener] 데이터베이스: https://your-project-default-rtdb.firebaseio.com
[PMS Listener] 실시간 리스닝 시작...
[PMS Listener] 종료하려면 Ctrl+C를 누르세요.
\`\`\`

**오류 발생 시:**

❌ `404 Not Found` 오류:
- Firebase Database URL이 잘못되었습니다
- Firebase Console에서 정확한 URL을 다시 확인하세요
- 플레이스홀더 URL(`your-project.firebaseio.com`)을 실제 URL로 변경했는지 확인

❌ `Invalid argument` 오류:
- 경로에 숨겨진 문자가 포함되어 있습니다
- 경로를 복사하지 말고 직접 타이핑하세요

---

## 4단계: 자동 시작 설정 (선택사항)

### Windows 작업 스케줄러 사용

1. 작업 스케줄러 열기 (Win + R → `taskschd.msc`)
2. "기본 작업 만들기" 클릭
3. 이름: "PMS Firebase Listener"
4. 트리거: "컴퓨터를 시작할 때"
5. 작업: "프로그램 시작"
6. 프로그램: `python.exe`
7. 인수: `C:\PMS\pms_firebase_listener.py`
8. 완료

---

## 5단계: 테스트

### 5.1 키오스크에서 체크인

1. 키오스크에서 예약 선택
2. 체크인 진행

### 5.2 로컬 PMS 확인

리스너 콘솔에 다음과 같이 출력되어야 함:

\`\`\`
[PMS Listener] 체크인 처리 시작: B521 (홍길동)
[PMS Listener] ✓ 체크인 성공: B521
[PMS Listener] Firebase 완료 처리: -NxXxXxXxXxXxXxX
\`\`\`

### 5.3 Firebase Console 확인

1. Firebase Console → Realtime Database
2. `pms_queue` 노드 확인
3. 완료된 항목은 `status: "completed"` 상태

---

## 문제 해결

### Firebase 연결 실패

- 서비스 계정 키 파일 경로 확인
- 환경 변수 값 확인 (특히 `FIREBASE_PRIVATE_KEY`의 줄바꿈)

### AutoHotkey 실행 실패

- AHK 스크립트 경로 확인
- AutoHotkey 설치 확인
- 임시 파일 경로 쓰기 권한 확인

### 체크인이 PMS에 반영 안됨

- 리스너가 실행 중인지 확인
- Firebase Console에서 데이터 확인
- AutoHotkey 스크립트 단독 실행 테스트

---

## 보안 규칙 설정 (프로덕션)

테스트 완료 후 Firebase 보안 규칙 업데이트:

\`\`\`json
{
  "rules": {
    "pms_queue": {
      ".read": "auth != null",
      ".write": "auth != null"
    }
  }
}
\`\`\`

---

## 비용

- **Firebase Realtime Database 무료 플랜**:
  - 동시 연결: 100개
  - 저장 용량: 1GB
  - 다운로드: 10GB/월
  
→ 소규모 숙박업소에는 충분합니다.

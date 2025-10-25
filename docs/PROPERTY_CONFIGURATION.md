# Property 설정 가이드

## Property 구분

| Property | 객실 형식 | 오버레이 모드 | PMS 연동 |
|----------|----------|--------------|---------|
| Property1 | C###, D### | ✅ 활성화 | Firebase + AutoHotkey |
| Property2 | Kariv### | ✅ 활성화 | Firebase + AutoHotkey |
| Property3 | A###, B### | ❌ 비활성화 | Firebase + AutoHotkey |
| Property4 | Camp### | ❌ 비활성화 | Firebase + AutoHotkey |

## Property1 설정

### 특징
- 기존 EXE 키오스크 프로그램 위에 오버레이 버튼 표시
- 버튼 클릭 시 팝업으로 웹 키오스크 실행
- 체크인 완료 후 자동으로 EXE 프로그램으로 포커스 복구

### 환경변수
\`\`\`env
KIOSK_PROPERTY=property1
OVERLAY_MODE=true
PMS_WINDOW_TITLE="Property1 PMS"
\`\`\`

### 디렉토리 구조
\`\`\`
C:\PMS\Property1\
├── firebase-service-account.json
├── trigger.txt
├── room_status.json
├── listener.log
├── pms_firebase_manager_property1.py
└── pms_automator_property1.ahk
\`\`\`

## Property2 설정

### 특징
- Property1과 동일한 오버레이 모드
- Kariv 객실 전용

### 환경변수
\`\`\`env
KIOSK_PROPERTY=property2
OVERLAY_MODE=true
PMS_WINDOW_TITLE="Property2 PMS"
\`\`\`

### 디렉토리 구조
\`\`\`
C:\PMS\Property2\
├── firebase-service-account.json
├── trigger.txt
├── room_status.json
├── listener.log
├── pms_firebase_manager_property2.py
└── pms_automator_property2.ahk
\`\`\`

## Property3 설정

### 특징
- 일반 전체화면 키오스크 모드
- A동, B동 객실

### 환경변수
\`\`\`env
KIOSK_PROPERTY=property3
OVERLAY_MODE=false
\`\`\`

### Firebase 경로
\`\`\`
pms_queue/property3/
\`\`\`

## Property4 설정

### 특징
- 일반 전체화면 키오스크 모드
- Camp 객실 전용

### 환경변수
\`\`\`env
KIOSK_PROPERTY=property4
OVERLAY_MODE=false
\`\`\`

### Firebase 경로
\`\`\`
pms_queue/property4/
\`\`\`

## 자동 Property 감지

시스템은 객실 번호를 기반으로 자동으로 Property를 감지합니다:

\`\`\`typescript
// 예시
"C101" → property1
"D205" → property1
"Kariv301" → property2
"A101" → property3
"B205" → property3
"Camp101" → property4
\`\`\`

## 설정 변경 시 주의사항

1. **환경변수 변경 후 재시작 필수**
2. **Firebase 경로는 Property별로 분리됨**
3. **PMS 리스너 스크립트도 Property별로 실행**
4. **오버레이 모드는 Property1, 2에서만 사용**

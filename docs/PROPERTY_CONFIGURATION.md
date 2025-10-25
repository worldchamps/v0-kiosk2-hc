# Property 설정 가이드

## Property 구분

| Property | 객실 형식 | 실행 환경 | 프린터 | 접속 방법 |
|----------|----------|----------|--------|---------|
| Property1 | C###, D### | Electron (오버레이) | ❌ 사용 안함 | 로컬 Electron 앱 |
| Property2 | Kariv### | Electron (오버레이) | ❌ 사용 안함 | 로컬 Electron 앱 |
| Property3 | A###, B### | 웹 브라우저 (Chrome/Edge) | ✅ Web Serial Port | **서브도메인** |
| Property4 | Camp### | 웹 브라우저 (Chrome/Edge) | ✅ Web Serial Port | **서브도메인** |

## Property1 설정

### 특징
- Electron 오버레이 모드로 실행
- 기존 EXE 키오스크 프로그램 위에 버튼만 표시
- 버튼 클릭 시 팝업으로 웹 키오스크 실행
- 체크인 완료 후 자동으로 EXE 프로그램으로 포커스 복구
- 프린터 기능 **사용 안함**

### 환경변수
\`\`\`env
NEXT_PUBLIC_KIOSK_PROPERTY_ID=property1
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
- Property1과 동일한 Electron 오버레이 모드
- Kariv 객실 전용
- 프린터 기능 **사용 안함**

### 환경변수
\`\`\`env
NEXT_PUBLIC_KIOSK_PROPERTY_ID=property2
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

## Property3, 4 서브도메인 접속

### 서브도메인 매핑

**Property 3 (A, B동)**
- `property3.yourdomain.com`
- `a3.yourdomain.com`
- `ab.yourdomain.com`

**Property 4 (Camp)**
- `property4.yourdomain.com`
- `camp.yourdomain.com`

### 접속 방법

1. **웹 브라우저에서 서브도메인으로 접속**
   \`\`\`
   https://property3.yourdomain.com
   https://camp.yourdomain.com
   \`\`\`

2. **자동으로 Property 감지됨** - 환경변수 설정 불필요

3. **키오스크 모드로 실행 (권장)**
   \`\`\`bash
   chrome.exe --kiosk --app=https://property3.yourdomain.com
   \`\`\`

자세한 설정은 [SUBDOMAIN_SETUP.md](./SUBDOMAIN_SETUP.md)를 참고하세요.

## Property3 설정

### 특징
- **웹 브라우저(Chrome/Edge)에서 실행**
- Electron 사용 안함
- 일반 전체화면 키오스크 모드
- A동, B동 객실
- **Web Serial Port API로 프린터 연결**

### Firebase 경로
\`\`\`
pms_queue/property3/
\`\`\`

### 프린터 설정
- Web Serial Port API 사용
- Chrome/Edge에서 직접 시리얼 포트 연결
- 사용자가 처음 실행 시 프린터 포트 선택 필요

## Property4 설정

### 특징
- **웹 브라우저(Chrome/Edge)에서 실행**
- Electron 사용 안함
- 일반 전체화면 키오스크 모드
- Camp 객실 전용
- **Web Serial Port API로 프린터 연결**

### Firebase 경로
\`\`\`
pms_queue/property4/
\`\`\`

### 프린터 설정
- Web Serial Port API 사용
- Chrome/Edge에서 직접 시리얼 포트 연결
- 사용자가 처음 실행 시 프린터 포트 선택 필요

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

## Property별 기능 차이

### Electron 사용 여부
\`\`\`typescript
propertyUsesElectron(propertyId)
// property1, property2 → true
// property3, property4 → false
\`\`\`

### 프린터 사용 여부
\`\`\`typescript
propertyUsesPrinter(propertyId)
// property1, property2 → false
// property3, property4 → true
\`\`\`

### Web Serial Port 사용 여부
\`\`\`typescript
propertyUsesWebSerial(propertyId)
// property1, property2 → false
// property3, property4 → true
\`\`\`

## 설정 변경 시 주의사항

1. **환경변수 변경 후 재시작 필수**
2. **Firebase 경로는 Property별로 분리됨**
3. **PMS 리스너 스크립트도 Property별로 실행**
4. **Property3, 4는 Electron 없이 웹 브라우저에서 직접 실행**
5. **Property3, 4는 Web Serial Port API 권한 필요 (HTTPS 또는 localhost)**

## 브라우저 요구사항 (Property3, 4)

- Chrome 89 이상
- Edge 89 이상
- Web Serial Port API 지원 필수
- HTTPS 또는 localhost에서만 작동

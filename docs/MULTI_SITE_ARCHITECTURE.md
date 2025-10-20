# 다중 사이트 호텔 관리 시스템 아키텍처

## 개요

4개의 독립적인 호텔 속성(Property)을 관리하는 확장 가능한 시스템입니다.

## 시스템 구조

\`\`\`
┌─────────────────────────────────────────────────────────────┐
│                    키오스크 (Next.js)                        │
│                  체크인 API 엔드포인트                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Firebase Realtime Database                      │
│                                                               │
│  pms_queue/                                                   │
│  ├── property3/          (A###, B### 호실)                   │
│  │   ├── -Nxxx: {roomNumber, guestName, status...}          │
│  │   └── -Nyyy: {...}                                        │
│  └── property4/          (Camp ### 호실)                     │
│      ├── -Nzzz: {roomNumber, guestName, status...}          │
│      └── -Naaa: {...}                                        │
└────────────────────────────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
┌──────────────────┐    ┌──────────────────┐
│   Property 3     │    │   Property 4     │
│   로컬 컴퓨터     │    │   로컬 컴퓨터     │
│                  │    │                  │
│  Python Listener │    │  Python Listener │
│  ↓               │    │  ↓               │
│  AutoHotkey      │    │  AutoHotkey      │
│  ↓               │    │  ↓               │
│  PMS 프로그램    │    │  PMS 프로그램    │
└──────────────────┘    └──────────────────┘
\`\`\`

## 속성(Property) 구성

### Property 1
- **호실 형식**: C###, D### (예: C201, D305)
- **PMS 통합**: 독립적인 PMS 시스템 사용
- **Firebase 연동**: 불필요
- **특징**: 자체 체크인 시스템 운영

### Property 2
- **호실 형식**: Kariv ### (예: Kariv 101)
- **PMS 통합**: 독립적인 PMS 시스템 사용
- **Firebase 연동**: 불필요
- **특징**: 자체 체크인 시스템 운영

### Property 3
- **호실 형식**: A###, B### (예: A101, B521)
- **Firebase 경로**: `pms_queue/property3/`
- **리스너 스크립트**: `pms_firebase_listener_property3.py`
- **설정 디렉토리**: `C:\PMS\Property3\`

### Property 4
- **호실 형식**: Camp ### (예: Camp 101, Camp 205)
- **Firebase 경로**: `pms_queue/property4/`
- **리스너 스크립트**: `pms_firebase_listener_property4.py`
- **설정 디렉토리**: `C:\PMS\Property4\`

## 호실 번호 라우팅 로직

### 자동 속성 감지

키오스크의 체크인 API는 호실 번호를 분석하여 자동으로 올바른 속성을 결정합니다:

\`\`\`typescript
// lib/firebase-admin.ts
export function getPropertyFromRoomNumber(roomNumber: string): string {
  const upperRoom = roomNumber.toUpperCase().trim()
  
  // Property 3: A### 또는 B###
  if (upperRoom.match(/^[AB]\d{3}$/)) {
    return "property3"
  }
  
  // Property 4: Camp ###
  if (upperRoom.match(/^CAMP\s*\d{3}$/i)) {
    return "property4"
  }
  
  return "property3" // 기본값
}
\`\`\`

### 라우팅 예시

| 호실 번호 | 감지된 속성 | Firebase 경로 | PMS 통합 방식 |
|----------|------------|---------------|--------------|
| C201     | Property 1 | - | 독립 PMS |
| D305     | Property 1 | - | 독립 PMS |
| Kariv 101| Property 2 | - | 독립 PMS |
| A101     | property3  | pms_queue/property3/ | Firebase |
| B521     | property3  | pms_queue/property3/ | Firebase |
| Camp 101 | property4  | pms_queue/property4/ | Firebase |
| CAMP 205 | property4  | pms_queue/property4/ | Firebase |

## 설치 및 설정

### Property 3 설정

1. **디렉토리 생성**
   \`\`\`
   C:\PMS\Property3\
   \`\`\`

2. **파일 배치**
   - `firebase-service-account.json` (Firebase 인증 키)
   - `pms_automator.ahk` (AutoHotkey 스크립트)
   - `pms_firebase_listener_property3.py` (리스너)

3. **리스너 실행**
   \`\`\`bash
   python C:\PMS\Property3\pms_firebase_listener_property3.py
   \`\`\`

### Property 4 설정

1. **디렉토리 생성**
   \`\`\`
   C:\PMS\Property4\
   \`\`\`

2. **파일 배치**
   - `firebase-service-account.json` (Firebase 인증 키)
   - `pms_automator.ahk` (AutoHotkey 스크립트 - Property 4용)
   - `pms_firebase_listener_property4.py` (리스너)

3. **리스너 실행**
   \`\`\`bash
   python C:\PMS\Property4\pms_firebase_listener_property4.py
   \`\`\`

## 확장성

### 새 속성 추가 방법

1. **Firebase 경로 추가**
   - `pms_queue/property5/` 노드 생성

2. **호실 패턴 정의**
   - 새 호실 번호 형식 결정 (예: E###, F###)

3. **라우팅 로직 업데이트**
   \`\`\`typescript
   // lib/firebase-admin.ts
   if (upperRoom.match(/^[EF]\d{3}$/)) {
     return "property5"
   }
   \`\`\`

4. **리스너 스크립트 복사**
   - `pms_firebase_listener_property5.py` 생성
   - `PROPERTY_NAME`, `ROOM_PATTERNS` 수정

5. **로컬 설정**
   - `C:\PMS\Property5\` 디렉토리 생성
   - 필요한 파일 배치 및 리스너 실행

## 장점

✅ **독립성**: 각 속성이 독립적으로 운영  
✅ **확장성**: 새 속성 추가 용이  
✅ **격리**: 한 속성의 문제가 다른 속성에 영향 없음  
✅ **유연성**: 속성별 맞춤 설정 가능 (독립 PMS 또는 Firebase)  
✅ **실시간**: Firebase를 통한 즉시 알림  
✅ **추적성**: 속성별 로그 파일로 디버깅 용이

## 모니터링

각 속성의 로그 파일:
- Property 3: `C:\PMS\Property3\listener.log`
- Property 4: `C:\PMS\Property4\listener.log`

Firebase Console에서 실시간 데이터 확인:
- `pms_queue/property3/` - Property 3 큐 (A###, B###)
- `pms_queue/property4/` - Property 4 큐 (Camp ###)

## 문제 해결

### 체크인이 처리되지 않는 경우

1. **리스너 실행 확인**
   - 해당 속성의 Python 스크립트가 실행 중인지 확인

2. **호실 번호 형식 확인**
   - 로그에서 "이 속성에서 처리할 수 없는 호실" 메시지 확인
   - 호실 번호가 올바른 형식인지 검증
   - Property 3: A### 또는 B###
   - Property 4: Camp ###

3. **Firebase 경로 확인**
   - Firebase Console에서 데이터가 올바른 경로에 저장되는지 확인

4. **로그 파일 확인**
   - 각 속성의 `listener.log` 파일에서 상세 오류 확인

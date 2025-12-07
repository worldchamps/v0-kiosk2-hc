# 원격 프린팅 시스템 가이드

다른 웹앱에서 키오스크 프린터로 객실 정보(호수, 비밀번호)를 원격으로 출력할 수 있는 시스템입니다.

---

## 1. API 사용법

### 엔드포인트

\`\`\`
POST https://your-kiosk-app.vercel.app/api/remote-print
\`\`\`

### 헤더

\`\`\`
x-api-key: YOUR_API_KEY
Content-Type: application/json
\`\`\`

### 요청 본문

\`\`\`json
{
  "roomNumber": "A101",
  "password": "1234"
}
\`\`\`

### 응답

**성공 (200)**
\`\`\`json
{
  "success": true,
  "message": "Print job added to queue",
  "printJobId": "-NxXxXxXxXxXxXxX"
}
\`\`\`

**실패 (401)**
\`\`\`json
{
  "error": "Unauthorized"
}
\`\`\`

**실패 (400)**
\`\`\`json
{
  "error": "Room number and password are required"
}
\`\`\`

---

## 2. 다른 웹앱에서 호출 예시

### JavaScript/TypeScript

\`\`\`typescript
async function printRoomInfo(roomNumber: string, password: string) {
  const response = await fetch('https://your-kiosk-app.vercel.app/api/remote-print', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.KIOSK_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      roomNumber,
      password,
    }),
  })

  if (!response.ok) {
    throw new Error('Failed to send print job')
  }

  const data = await response.json()
  console.log('Print job created:', data.printJobId)
  return data
}

// 사용 예시
await printRoomInfo('A101', '1234')
\`\`\`

### Python

\`\`\`python
import requests
import os

def print_room_info(room_number: str, password: str):
    url = 'https://your-kiosk-app.vercel.app/api/remote-print'
    headers = {
        'x-api-key': os.getenv('KIOSK_API_KEY'),
        'Content-Type': 'application/json'
    }
    data = {
        'roomNumber': room_number,
        'password': password
    }
    
    response = requests.post(url, headers=headers, json=data)
    response.raise_for_status()
    
    result = response.json()
    print(f"Print job created: {result['printJobId']}")
    return result

# 사용 예시
print_room_info('A101', '1234')
\`\`\`

### cURL

\`\`\`bash
curl -X POST https://your-kiosk-app.vercel.app/api/remote-print \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"roomNumber":"A101","password":"1234"}'
\`\`\`

---

## 3. Firebase 데이터 구조

### print_queue 경로

\`\`\`
print_queue/
├── property3/          (A###, B### 호실)
│   └── {auto-id}/
│       ├── id: string
│       ├── action: "remote-print"
│       ├── roomNumber: string
│       ├── password: string
│       ├── status: "pending" | "completed"
│       ├── property: "property3"
│       ├── createdAt: ISO timestamp
│       └── completedAt: ISO timestamp | null
│
└── property4/          (CAMP ### 호실)
    └── {auto-id}/
        └── (동일한 구조)
\`\`\`

### 데이터 예시

\`\`\`json
{
  "id": "-NxXxXxXxXxXxXxX",
  "action": "remote-print",
  "roomNumber": "A101",
  "password": "1234",
  "status": "pending",
  "property": "property3",
  "createdAt": "2025-01-19T10:30:00.000Z",
  "completedAt": null
}
\`\`\`

---

## 4. 프린트 출력 내용

영수증에는 다음 정보만 출력됩니다:

\`\`\`
================================
    더 비치스테이 A동
================================

객실 번호: A101
층수: 1층
비밀번호: 1234

================================
\`\`\`

**개인정보 보호**: 고객 이름은 출력되지 않습니다.

---

## 5. 자동 라우팅

호실 번호로 자동으로 property를 판별합니다:

| 호실 패턴 | Property | 예시 |
|----------|----------|------|
| A### | property3 | A101, A205 |
| B### | property3 | B301, B412 |
| CAMP ### | property4 | CAMP 101, CAMP 205 |

---

## 6. 환경 변수 설정

### 키오스크 웹앱 (Vercel)

\`\`\`env
API_KEY=your-secure-api-key
ADMIN_API_KEY=your-admin-api-key

# Firebase (이미 설정됨)
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=...
FIREBASE_DATABASE_URL=...

# Firebase Client (추가 필요)
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
\`\`\`

### 다른 웹앱

\`\`\`env
KIOSK_API_KEY=your-secure-api-key
KIOSK_APP_URL=https://your-kiosk-app.vercel.app
\`\`\`

---

## 7. 테스트

### 1단계: API 테스트

\`\`\`bash
curl -X POST https://your-kiosk-app.vercel.app/api/remote-print \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"roomNumber":"A101","password":"1234"}'
\`\`\`

### 2단계: Firebase 확인

Firebase Console → Realtime Database → `print_queue/property3` 확인

### 3단계: 키오스크 확인

키오스크 화면 우측 하단에 "원격 프린트 대기중" 표시 확인

### 4단계: 프린터 출력 확인

자동으로 영수증이 출력되는지 확인

---

## 8. 문제 해결

### API 호출 실패 (401 Unauthorized)

- API 키가 올바른지 확인
- 헤더에 `x-api-key`가 포함되었는지 확인

### 프린터 출력 안됨

- 키오스크 앱이 실행 중인지 확인
- 프린터가 연결되어 있는지 확인
- Firebase Console에서 `print_queue` 데이터 확인
- 브라우저 콘솔에서 `[PrintQueue]` 로그 확인

### 잘못된 property로 라우팅

- 호실 번호 형식 확인 (A101, B205, CAMP 101)
- `getPropertyFromRoomNumber()` 함수 로직 확인

---

## 9. 보안 고려사항

1. **API 키 보호**: 환경 변수로 관리, 절대 코드에 하드코딩 금지
2. **HTTPS 사용**: 모든 API 호출은 HTTPS로만 허용
3. **Firebase 규칙**: 프로덕션 환경에서는 인증된 요청만 허용
4. **개인정보**: 고객 이름 등 민감 정보는 프린트하지 않음

---

## 10. 향후 확장

- [ ] 프린트 실패 시 재시도 로직
- [ ] 프린트 히스토리 로깅
- [ ] 여러 키오스크 동시 관리
- [ ] 프린트 상태 실시간 모니터링 대시보드
\`\`\`

\`\`\`json file="" isHidden

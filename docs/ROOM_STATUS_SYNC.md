# BeachRoomStatus 동기화 가이드

## 개요

PMS 웹앱에서 객실 상태를 변경하면 BeachRoomStatus 스프레드시트에 자동으로 반영되도록 하는 API입니다.

---

## API 사용법

### 엔드포인트

\`\`\`
POST https://your-kiosk-app.vercel.app/api/room-status/update
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
  "status": "occupied"
}
\`\`\`

### 유효한 상태 값

- `vacant` - 공실
- `occupied` - 투숙중
- `cleaning` - 청소중
- `maintenance` - 점검중

### 응답

**성공 (200)**
\`\`\`json
{
  "success": true,
  "message": "Room status updated successfully",
  "data": {
    "roomNumber": "A101",
    "status": "occupied",
    "rowIndex": 5
  }
}
\`\`\`

**실패 (401 Unauthorized)**
\`\`\`json
{
  "error": "Unauthorized"
}
\`\`\`

**실패 (400 Bad Request)**
\`\`\`json
{
  "error": "Invalid status. Must be one of: vacant, occupied, cleaning, maintenance"
}
\`\`\`

**실패 (404 Not Found)**
\`\`\`json
{
  "error": "Room A101 not found in Beach Room Status"
}
\`\`\`

---

## PMS 웹앱 통합

### JavaScript/TypeScript

\`\`\`typescript
async function updateRoomStatus(roomNumber: string, status: string) {
  const response = await fetch('https://your-kiosk-app.vercel.app/api/room-status/update', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.KIOSK_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      roomNumber,
      status,
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error)
  }

  const data = await response.json()
  console.log('Room status updated:', data)
  return data
}

// 사용 예시
await updateRoomStatus('A101', 'occupied')
await updateRoomStatus('B205', 'cleaning')
await updateRoomStatus('Camp 5', 'vacant')
\`\`\`

### Python

\`\`\`python
import requests
import os

def update_room_status(room_number: str, status: str):
    url = 'https://your-kiosk-app.vercel.app/api/room-status/update'
    headers = {
        'x-api-key': os.getenv('KIOSK_API_KEY'),
        'Content-Type': 'application/json'
    }
    data = {
        'roomNumber': room_number,
        'status': status
    }
    
    response = requests.post(url, headers=headers, json=data)
    response.raise_for_status()
    
    result = response.json()
    print(f"Room status updated: {result}")
    return result

# 사용 예시
update_room_status('A101', 'occupied')
update_room_status('B205', 'cleaning')
update_room_status('Camp 5', 'vacant')
\`\`\`

### cURL

\`\`\`bash
curl -X POST https://your-kiosk-app.vercel.app/api/room-status/update \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"roomNumber":"A101","status":"occupied"}'
\`\`\`

---

## 통합 시나리오

### 시나리오 1: 체크인 완료 시

\`\`\`typescript
// PMS 웹앱에서 체크인 처리 후
async function handleCheckIn(roomNumber: string) {
  // 1. 로컬 PMS 업데이트
  await updateLocalPMS(roomNumber, 'checkin')
  
  // 2. BeachRoomStatus 동기화
  await updateRoomStatus(roomNumber, 'occupied')
  
  console.log(`Check-in completed for room ${roomNumber}`)
}
\`\`\`

### 시나리오 2: 체크아웃 완료 시

\`\`\`typescript
async function handleCheckOut(roomNumber: string) {
  // 1. 로컬 PMS 업데이트
  await updateLocalPMS(roomNumber, 'checkout')
  
  // 2. BeachRoomStatus를 청소중으로 변경
  await updateRoomStatus(roomNumber, 'cleaning')
  
  console.log(`Check-out completed for room ${roomNumber}`)
}
\`\`\`

### 시나리오 3: 청소 완료 시

\`\`\`typescript
async function handleCleaningComplete(roomNumber: string) {
  // 1. 로컬 PMS 업데이트
  await updateLocalPMS(roomNumber, 'cleaning_complete')
  
  // 2. BeachRoomStatus를 공실로 변경
  await updateRoomStatus(roomNumber, 'vacant')
  
  console.log(`Cleaning completed for room ${roomNumber}`)
}
\`\`\`

---

## BeachRoomStatus 스프레드시트 구조

| A (building) | B (roomNumber) | C (roomType) | D (status) | E (price) | F (floor) | G (password) |
|--------------|----------------|--------------|------------|-----------|-----------|--------------|
| A동          | A101           | 스탠다드      | vacant     | 100000    | 1층       | 1234         |
| A동          | A102           | 디럭스        | occupied   | 150000    | 1층       | 5678         |
| B동          | B201           | 스위트        | cleaning   | 200000    | 2층       | 9012         |

**업데이트되는 열:** D열 (status)

---

## 환경 변수 설정

### 키오스크 웹앱 (Vercel)

이미 설정되어 있습니다:
\`\`\`env
API_KEY=your-secure-api-key
ADMIN_API_KEY=your-admin-api-key
GOOGLE_SHEETS_SPREADSHEET_ID=...
GOOGLE_SHEETS_CLIENT_EMAIL=...
GOOGLE_SHEETS_PRIVATE_KEY=...
\`\`\`

### PMS 웹앱

\`\`\`env
KIOSK_API_KEY=your-secure-api-key
KIOSK_APP_URL=https://your-kiosk-app.vercel.app
\`\`\`

---

## 테스트

### 1단계: API 테스트

\`\`\`bash
curl -X POST https://your-kiosk-app.vercel.app/api/room-status/update \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"roomNumber":"A101","status":"occupied"}'
\`\`\`

### 2단계: 스프레드시트 확인

Google Sheets → BeachRoomStatus → A101 행의 D열(status) 확인

### 3단계: 키오스크 확인

키오스크에서 객실 선택 시 업데이트된 상태가 반영되는지 확인

---

## 문제 해결

### API 호출 실패 (401)

- API 키가 올바른지 확인
- 헤더에 `x-api-key`가 포함되었는지 확인

### 객실을 찾을 수 없음 (404)

- BeachRoomStatus 시트에 해당 객실이 존재하는지 확인
- 객실 번호 형식이 정확한지 확인 (대소문자, 공백)

### 상태가 업데이트 안됨

- Google Sheets API 권한 확인
- 스프레드시트 ID가 올바른지 확인
- 서비스 계정에 편집 권한이 있는지 확인

---

## 보안

1. **API 키 보호**: 환경 변수로 관리, 절대 코드에 하드코딩 금지
2. **HTTPS 사용**: 모든 API 호출은 HTTPS로만 허용
3. **권한 제한**: 서비스 계정에 최소 권한만 부여
4. **로깅**: 모든 상태 변경 로그 기록

---

## 향후 확장

- [ ] 일괄 업데이트 API (여러 객실 동시 업데이트)
- [ ] 상태 변경 히스토리 추적
- [ ] Webhook을 통한 실시간 알림
- [ ] 상태 변경 검증 로직 (예: occupied → vacant 직접 변경 불가)

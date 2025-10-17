# PMS 연동 가이드

## 개요

키오스크에서 체크인이 발생하면 자동으로 로컬 PMS 프로그램에 객실 상태 변경 신호를 전송하는 시스템입니다.

## 아키텍처

\`\`\`
[키오스크] → [Vercel API] → [Google Sheets - PMS Queue]
                                      ↑
                          [로컬 PMS 컴퓨터] (폴링)
\`\`\`

## Google Sheets 설정

### 1. 새 시트 생성

Google Sheets에 **"PMS Queue"** 시트를 추가하고 다음 헤더를 설정하세요:

| A | B | C | D | E | F | G |
|---|---|---|---|---|---|---|
| ID | Room Number | Guest Name | Check-in Date | Status | Created At | Completed At |

### 2. 열 설명

- **ID**: 고유 식별자 (자동 생성)
- **Room Number**: 객실 번호
- **Guest Name**: 투숙객 이름
- **Check-in Date**: 체크인 날짜
- **Status**: `pending` 또는 `completed`
- **Created At**: 생성 시간
- **Completed At**: 처리 완료 시간

## API 엔드포인트

### 1. 대기 중인 체크인 조회

\`\`\`http
GET /api/pms-queue
Headers:
  Authorization: YOUR_API_KEY
\`\`\`

**응답 예시:**
\`\`\`json
{
  "success": true,
  "data": [
    {
      "id": "PMS-1737123456789",
      "roomNumber": "101",
      "guestName": "홍길동",
      "checkInDate": "2025-01-17",
      "status": "pending",
      "createdAt": "2025-01-17T10:30:00.000Z"
    }
  ],
  "count": 1
}
\`\`\`

### 2. 처리 완료 표시

\`\`\`http
POST /api/pms-queue/complete
Headers:
  Authorization: YOUR_API_KEY
Content-Type: application/json

{
  "id": "PMS-1737123456789"
}
\`\`\`

## 로컬 PMS 연동

### 1. Python 스크립트 설치

\`\`\`bash
# 필요한 패키지 설치
pip install requests

# 스크립트 다운로드
# scripts/pms_listener.py 파일을 로컬 PMS 컴퓨터에 복사
\`\`\`

### 2. 설정 수정

`pms_listener.py` 파일을 열고 다음 값을 수정하세요:

\`\`\`python
API_URL = "https://your-kiosk.vercel.app/api/pms-queue"
API_KEY = "your-api-key-here"  # 환경 변수 API_KEY 값
POLL_INTERVAL = 3  # 폴링 간격 (초)
\`\`\`

### 3. PMS 연동 로직 구현

`update_pms_room_status()` 함수에 실제 PMS 연동 로직을 추가하세요:

\`\`\`python
def update_pms_room_status(room_number, guest_name, check_in_date):
    # 예시 1: REST API 사용
    pms_api_url = "http://localhost:8080/api/rooms/update"
    response = requests.post(pms_api_url, json={
        "roomNumber": room_number,
        "status": "occupied",
        "guestName": guest_name
    })
    
    # 예시 2: 데이터베이스 직접 업데이트
    # import sqlite3
    # conn = sqlite3.connect('pms.db')
    # cursor = conn.cursor()
    # cursor.execute("UPDATE rooms SET status='occupied', guest=? WHERE number=?", 
    #                (guest_name, room_number))
    # conn.commit()
    
    return True
\`\`\`

### 4. 스크립트 실행

\`\`\`bash
python pms_listener.py
\`\`\`

### 5. 자동 시작 설정 (선택사항)

**Windows:**
- 작업 스케줄러에 등록
- 시스템 시작 시 자동 실행

**Linux/Mac:**
\`\`\`bash
# crontab 추가
@reboot python /path/to/pms_listener.py
\`\`\`

## 동작 흐름

1. 키오스크에서 체크인 발생
2. `/api/check-in` API가 Google Sheets의 "PMS Queue"에 데이터 추가
3. 로컬 PMS 컴퓨터의 스크립트가 3초마다 큐 확인
4. 새 체크인 발견 시 PMS 프로그램 업데이트
5. 성공 시 해당 항목을 "completed" 상태로 변경

## 문제 해결

### API 인증 실패
- 환경 변수 `API_KEY` 또는 `ADMIN_API_KEY` 확인
- 스크립트의 `API_KEY` 값이 일치하는지 확인

### PMS Queue 시트가 없음
- Google Sheets에 "PMS Queue" 시트 생성
- 헤더 행 확인

### 폴링이 작동하지 않음
- 네트워크 연결 확인
- API URL이 올바른지 확인
- 스크립트 로그 확인

## 보안 고려사항

- API 키는 환경 변수로 관리
- HTTPS 사용 (Vercel 자동 제공)
- 로컬 네트워크에서만 PMS 접근 권장

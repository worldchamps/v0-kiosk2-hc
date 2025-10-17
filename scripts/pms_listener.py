"""
로컬 PMS 연동 스크립트
이 스크립트를 로컬 PMS 컴퓨터에서 실행하세요.

필요한 패키지 설치:
pip install requests

실행 방법:
python pms_listener.py
"""

import requests
import time
import json
from datetime import datetime

# 설정
API_URL = "https://your-kiosk.vercel.app/api/pms-queue"
API_KEY = "your-api-key-here"  # 환경 변수 API_KEY 또는 ADMIN_API_KEY 값 사용
POLL_INTERVAL = 3  # 3초마다 확인

def update_pms_room_status(room_number, guest_name, check_in_date):
    """
    로컬 PMS 프로그램에 객실 상태 업데이트
    
    이 함수를 실제 PMS 프로그램의 API나 데이터베이스 연동 로직으로 교체하세요.
    예시:
    - PMS가 REST API를 제공하는 경우: requests.post(PMS_API_URL, ...)
    - PMS가 데이터베이스를 사용하는 경우: SQL UPDATE 쿼리 실행
    - PMS가 파일 기반인 경우: 파일 업데이트
    """
    print(f"[PMS 업데이트] 객실: {room_number}, 투숙객: {guest_name}, 체크인: {check_in_date}")
    
    # TODO: 실제 PMS 연동 로직 구현
    # 예시:
    # pms_api_url = "http://localhost:8080/api/rooms/update"
    # response = requests.post(pms_api_url, json={
    #     "roomNumber": room_number,
    #     "status": "occupied",
    #     "guestName": guest_name,
    #     "checkInDate": check_in_date
    # })
    
    return True

def mark_as_completed(queue_id):
    """큐 항목을 완료 상태로 표시"""
    try:
        response = requests.post(
            f"{API_URL}/complete",
            headers={"Authorization": API_KEY},
            json={"id": queue_id}
        )
        
        if response.status_code == 200:
            print(f"[완료] 큐 ID: {queue_id}")
            return True
        else:
            print(f"[오류] 완료 표시 실패: {response.text}")
            return False
    except Exception as e:
        print(f"[오류] 완료 표시 중 예외 발생: {e}")
        return False

def poll_queue():
    """큐를 폴링하여 새 체크인 확인"""
    try:
        response = requests.get(
            API_URL,
            headers={"Authorization": API_KEY}
        )
        
        if response.status_code == 200:
            data = response.json()
            pending_checkins = data.get("data", [])
            
            if pending_checkins:
                print(f"\n[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {len(pending_checkins)}개의 대기 중인 체크인 발견")
                
                for checkin in pending_checkins:
                    queue_id = checkin.get("id")
                    room_number = checkin.get("roomNumber")
                    guest_name = checkin.get("guestName")
                    check_in_date = checkin.get("checkInDate")
                    
                    print(f"\n처리 중: {room_number}호 - {guest_name}")
                    
                    # PMS 업데이트
                    if update_pms_room_status(room_number, guest_name, check_in_date):
                        # 성공하면 완료 표시
                        mark_as_completed(queue_id)
                    else:
                        print(f"[경고] PMS 업데이트 실패: {room_number}호")
            
        elif response.status_code == 401:
            print("[오류] 인증 실패. API_KEY를 확인하세요.")
        else:
            print(f"[오류] API 호출 실패: {response.status_code} - {response.text}")
            
    except Exception as e:
        print(f"[오류] 폴링 중 예외 발생: {e}")

def main():
    """메인 루프"""
    print("=" * 60)
    print("PMS 리스너 시작")
    print(f"API URL: {API_URL}")
    print(f"폴링 간격: {POLL_INTERVAL}초")
    print("=" * 60)
    print("\n종료하려면 Ctrl+C를 누르세요.\n")
    
    try:
        while True:
            poll_queue()
            time.sleep(POLL_INTERVAL)
    except KeyboardInterrupt:
        print("\n\nPMS 리스너 종료")

if __name__ == "__main__":
    main()

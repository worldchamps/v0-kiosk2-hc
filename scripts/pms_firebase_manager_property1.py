import firebase_admin
from firebase_admin import credentials, db
import os
import time
import json
import threading
import requests

PROPERTY = "property1"
FIREBASE_PATH = f"pms_queue/{PROPERTY}"
FIREBASE_STATUS_PATH = f"pms_status/{PROPERTY}"

FIREBASE_CREDENTIALS_PATH = r"C:\PMS\Property1\firebase-service-account.json"
FIREBASE_DATABASE_URL = "https://kiosk-pms-default-rtdb.asia-southeast1.firebasedatabase.app/"

TRIGGER_FILE = r"C:\PMS\Property1\trigger.txt"
ROOM_STATUS_JSON = r"C:\PMS\Property1\room_status.json"

LOG_FILE = r"C:\PMS\Property1\listener.log"

WEB_APP_URL = "https://v0-pms-seven.vercel.app/"
API_KEY = os.environ.get('API_KEY', '')

def log(message):
    timestamp = time.strftime('%Y-%m-%d %H:%M:%S')
    log_message = f"[{timestamp}] {message}"
    print(log_message)
    
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(log_message + '\n')
    except Exception as e:
        print(f"로그 저장 실패: {e}")

def init_firebase():
    try:
        log(f"Firebase 초기화 시작...")
        log(f"  - 인증 파일 경로: {FIREBASE_CREDENTIALS_PATH}")
        log(f"  - 데이터베이스 URL: {FIREBASE_DATABASE_URL}")
        
        if not os.path.exists(FIREBASE_CREDENTIALS_PATH):
            log(f"❌ Firebase 인증 파일 없음: {FIREBASE_CREDENTIALS_PATH}")
            return False
        
        log(f"✓ Firebase 인증 파일 확인됨")
        
        cred = credentials.Certificate(FIREBASE_CREDENTIALS_PATH)
        firebase_admin.initialize_app(cred, {'databaseURL': FIREBASE_DATABASE_URL})
        log(f"✓ Firebase 연결 성공 ({PROPERTY})")
        return True
    except Exception as e:
        log(f"❌ Firebase 초기화 실패: {e}")
        import traceback
        log(f"상세 오류:\n{traceback.format_exc()}")
        return False

def monitor_room_status():
    """JSON 파일을 읽어 Firebase로 객실 상태 업로드"""
    log("객실 상태 모니터링 시작")
    last_update_time = 0
    
    while True:
        try:
            if os.path.exists(ROOM_STATUS_JSON):
                file_mod_time = os.path.getmtime(ROOM_STATUS_JSON)
                
                if file_mod_time > last_update_time:
                    with open(ROOM_STATUS_JSON, 'r', encoding='utf-8-sig') as f:
                        status_data = json.load(f)
                    
                    if status_data and 'rooms' in status_data:
                        ref = db.reference(FIREBASE_STATUS_PATH)
                        ref.set(status_data)
                        log(f"객실 상태 업데이트: {len(status_data['rooms'])}개")
                        last_update_time = file_mod_time
            
            time.sleep(10)
            
        except Exception as e:
            log(f"상태 모니터링 오류: {e}")
            time.sleep(30)

def update_google_sheets(room_number, new_status):
    """웹앱 API를 통해 Google Sheets 업데이트"""
    try:
        response = requests.get(
            f"{WEB_APP_URL}/api/room-status",
            headers={"x-api-key": API_KEY} if API_KEY else {},
            timeout=10
        )
        
        if response.status_code != 200:
            log(f"객실 목록 조회 실패: {response.status_code}")
            return False
        
        rooms = response.json()
        room_id = None
        
        for room in rooms:
            if room.get('roomNumber') == room_number or room.get('matchingRoomNumber') == room_number:
                room_id = room.get('id')
                break
        
        if not room_id:
            log(f"Google Sheets에서 객실 찾을 수 없음: {room_number}")
            return False
        
        update_response = requests.put(
            f"{WEB_APP_URL}/api/update-room-status",
            json={"roomId": room_id, "newStatus": new_status},
            headers={"x-api-key": API_KEY} if API_KEY else {},
            timeout=10
        )
        
        if update_response.status_code == 200:
            log(f"Google Sheets 업데이트 성공: {room_number} -> {new_status}")
            return True
        else:
            log(f"Google Sheets 업데이트 실패: {update_response.status_code}")
            return False
            
    except Exception as e:
        log(f"Google Sheets 업데이트 오류: {e}")
        return False

def map_action_to_status(action):
    """액션을 Google Sheets 상태로 매핑"""
    status_map = {
        'checkin': '사용중',
        'checkout': '청소대기중',
        'clean': '공실',
        'dirty': '청소대기중'
    }
    return status_map.get(action, '공실')

def execute_pms_automation(room_number, action, guest_name, queue_id):
    try:
        log(f"🔄 {action} 시작: {room_number} ({guest_name})")
        
        # 트리거 파일 생성
        os.makedirs(os.path.dirname(TRIGGER_FILE), exist_ok=True)
        
        trigger_data = {
            'room_number': room_number,
            'action': action,
            'guest_name': guest_name,
            'queue_id': queue_id,
            'timestamp': time.strftime('%Y-%m-%d %H:%M:%S')
        }
        
        with open(TRIGGER_FILE, 'w', encoding='utf-8') as f:
            json.dump(trigger_data, f, ensure_ascii=False, indent=2)
        
        log(f"✓ 트리거 파일 생성: {TRIGGER_FILE}")
        log(f"  - 데이터: {trigger_data}")
        
        # AHK가 파일을 처리할 때까지 대기 (최대 60초)
        max_wait = 60
        wait_count = 0
        
        while os.path.exists(TRIGGER_FILE) and wait_count < max_wait:
            time.sleep(1)
            wait_count += 1
        
        if wait_count >= max_wait:
            log(f"⏱️ 타임아웃: AHK가 트리거 파일을 처리하지 않음")
            mark_as_failed(queue_id, "타임아웃")
            return False
        
        log(f"✅ {action} 완료: {room_number} (처리 시간: {wait_count}초)")
        
        # Google Sheets 업데이트
        new_status = map_action_to_status(action)
        update_google_sheets(room_number, new_status)
        
        mark_as_completed(queue_id)
        return True
            
    except Exception as e:
        log(f"❌ 실행 오류: {e}")
        import traceback
        log(f"상세 오류:\n{traceback.format_exc()}")
        mark_as_failed(queue_id, str(e))
        return False

def mark_as_completed(queue_id):
    try:
        ref = db.reference(f'{FIREBASE_PATH}/{queue_id}')
        ref.update({
            'status': 'completed',
            'completedAt': time.strftime('%Y-%m-%dT%H:%M:%S')
        })
        
        time.sleep(5)
        ref.delete()
        log(f"✅ 완료 처리: {queue_id}")
    except Exception as e:
        log(f"❌ 완료 처리 실패: {e}")

def mark_as_failed(queue_id, error_message):
    try:
        ref = db.reference(f'{FIREBASE_PATH}/{queue_id}')
        ref.update({
            'status': 'failed',
            'error': error_message,
            'failedAt': time.strftime('%Y-%m-%dT%H:%M:%S')
        })
        
        time.sleep(5)
        ref.delete()
        log(f"❌ 실패 처리: {queue_id}")
    except Exception as e:
        log(f"❌ 실패 처리 오류: {e}")

def on_queue_added(event):
    try:
        log(f"📨 Firebase 이벤트 수신!")
        log(f"  - Event Path: {event.path}")
        log(f"  - Event Data: {event.data}")
        
        data = event.data
        
        if not data:
            log(f"⚠️ 데이터 없음")
            return
        
        queue_id = event.path.strip('/') if event.path else None
        
        if not queue_id or queue_id == '/':
            log(f"⚠️ 유효하지 않은 queue_id: {queue_id}")
            return
        
        log(f"✓ Queue ID: {queue_id}")
        
        status = data.get('status')
        log(f"  - Status: {status}")
        
        if status != 'pending':
            log(f"⚠️ Pending 상태 아님, 무시")
            return
        
        room_number = data.get('roomNumber', '')
        guest_name = data.get('guestName', '')
        
        log(f"  - Room Number: {room_number}")
        log(f"  - Guest Name: {guest_name}")
        
        if not room_number:
            log(f"❌ 객실 번호 없음: {queue_id}")
            mark_as_failed(queue_id, "객실 번호 없음")
            return
        
        action = data.get('action')
        if not action:
            if data.get('checkInDate') and data.get('guestName'):
                action = 'checkin'
                log(f"  - Action 자동 설정: checkin")
            else:
                log(f"❌ 액션 타입 없음: {queue_id}")
                mark_as_failed(queue_id, "액션 타입 없음")
                return
        else:
            log(f"  - Action: {action}")
        
        execute_pms_automation(room_number, action, guest_name, queue_id)
        
    except Exception as e:
        log(f"❌ 처리 오류: {e}")
        import traceback
        log(f"상세 오류:\n{traceback.format_exc()}")

def main():
    log("=" * 60)
    log(f"🚀 PMS Firebase Manager 시작 - {PROPERTY}")
    log("=" * 60)
    
    log(f"📋 설정 정보:")
    log(f"  - Property: {PROPERTY}")
    log(f"  - Firebase Path: {FIREBASE_PATH}")
    log(f"  - Firebase Status Path: {FIREBASE_STATUS_PATH}")
    log(f"  - Trigger File: {TRIGGER_FILE}")
    log(f"  - Log File: {LOG_FILE}")
    log(f"  - API Key 설정: {'✓' if API_KEY else '✗'}")
    log("=" * 60)
    
    if not init_firebase():
        log("❌ 종료: Firebase 초기화 실패")
        input("Press Enter to exit...")
        return
    
    status_thread = threading.Thread(target=monitor_room_status, daemon=True)
    status_thread.start()
    log("✓ 객실 상태 모니터링 스레드 시작")
    
    try:
        ref = db.reference(FIREBASE_PATH)
        ref.listen(on_queue_added)
        
        log(f"👂 리스닝 시작: {FIREBASE_PATH}")
        log("✓ 준비 완료! 체크인 요청 대기 중...")
        log("종료: Ctrl+C")
        log("=" * 60)
        
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        log("👋 종료")
    except Exception as e:
        log(f"❌ 메인 루프 오류: {e}")
        import traceback
        log(f"상세 오류:\n{traceback.format_exc()}")
        input("Press Enter to exit...")

if __name__ == "__main__":
    main()

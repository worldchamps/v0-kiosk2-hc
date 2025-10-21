import firebase_admin
from firebase_admin import credentials, db
import subprocess
import os
import time
import json
import threading
import requests

PROPERTY = "property2"
FIREBASE_PATH = f"pms_queue/{PROPERTY}"
FIREBASE_STATUS_PATH = f"pms_status/{PROPERTY}"

FIREBASE_CREDENTIALS_PATH = r"C:\PMS\Property2\firebase-service-account.json"
FIREBASE_DATABASE_URL = "https://kiosk-pms-default-rtdb.asia-southeast1.firebasedatabase.app/"

AHK_SCRIPT_PATH = r"C:\PMS\Property2\pms_automator_property2.ahk"
AHK_EXE_PATH = r"C:\Program Files\AutoHotkey\v1.1.37.02\AutoHotkeyU64.exe"
ROOM_NUMBER_FILE = r"C:\PMS\Property2\room_number_data.tmp"
ROOM_STATUS_JSON = r"C:\PMS\Property2\room_status.json"

LOG_FILE = r"C:\PMS\Property2\listener.log"

WEB_APP_URL = "https://v0-pms-seven.vercel.app/"  # 실제 배포된 URL로 변경 필요
API_KEY = os.environ.get('API_KEY', '')  # 환경 변수에서 API 키 읽기

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
        if not os.path.exists(FIREBASE_CREDENTIALS_PATH):
            log(f"Firebase 인증 파일 없음: {FIREBASE_CREDENTIALS_PATH}")
            return False
            
        cred = credentials.Certificate(FIREBASE_CREDENTIALS_PATH)
        firebase_admin.initialize_app(cred, {'databaseURL': FIREBASE_DATABASE_URL})
        log(f"Firebase 연결 성공 ({PROPERTY})")
        return True
    except Exception as e:
        log(f"Firebase 초기화 실패: {e}")
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
        # roomNumber로 roomId 찾기 (BeachRoomStatus에서 매칭)
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
        
        # Google Sheets 업데이트
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
        log(f"{action} 시작: {room_number} ({guest_name})")
        
        if not os.path.exists(AHK_EXE_PATH):
            log(f"AutoHotkey 실행 파일 없음: {AHK_EXE_PATH}")
            mark_as_failed(queue_id, "AutoHotkey 실행 파일 없음")
            return False
            
        if not os.path.exists(AHK_SCRIPT_PATH):
            log(f"AutoHotkey 스크립트 없음: {AHK_SCRIPT_PATH}")
            mark_as_failed(queue_id, "AutoHotkey 스크립트 없음")
            return False
        
        log(f"AutoHotkey 경로 확인 완료")
        log(f"  - EXE: {AHK_EXE_PATH}")
        log(f"  - Script: {AHK_SCRIPT_PATH}")
        log(f"  - Action: {action}")
        
        os.makedirs(os.path.dirname(ROOM_NUMBER_FILE), exist_ok=True)
        
        with open(ROOM_NUMBER_FILE, 'w', encoding='utf-8') as f:
            f.write(room_number)
        log(f"객실 번호 파일 작성: {room_number}")
        
        command = [AHK_EXE_PATH, AHK_SCRIPT_PATH, action]
        log(f"AutoHotkey 실행 명령: {' '.join(command)}")
        
        result = subprocess.run(command, capture_output=True, text=True, timeout=30)
        
        log(f"AutoHotkey 종료 코드: {result.returncode}")
        if result.stdout:
            log(f"AutoHotkey 출력: {result.stdout}")
        if result.stderr:
            log(f"AutoHotkey 에러: {result.stderr}")
        
        if result.returncode == 0:
            log(f"{action} 성공: {room_number}")
            
            new_status = map_action_to_status(action)
            update_google_sheets(room_number, new_status)
            
            mark_as_completed(queue_id)
            return True
        else:
            log(f"{action} 실패: {room_number} (종료 코드: {result.returncode})")
            mark_as_failed(queue_id, f"AutoHotkey 실행 실패 (코드: {result.returncode})")
            return False
            
    except subprocess.TimeoutExpired:
        log(f"타임아웃: {room_number}")
        mark_as_failed(queue_id, "타임아웃")
        return False
    except Exception as e:
        log(f"실행 오류: {e}")
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
        log(f"완료 처리: {queue_id}")
    except Exception as e:
        log(f"완료 처리 실패: {e}")

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
        log(f"실패 처리: {queue_id}")
    except Exception as e:
        log(f"실패 처리 오류: {e}")

def on_queue_added(event):
    try:
        data = event.data
        
        if not data:
            return
        
        queue_id = event.path.strip('/') if event.path else None
        
        if not queue_id or queue_id == '/':
            return
        
        status = data.get('status')
        if status != 'pending':
            return
        
        room_number = data.get('roomNumber', '')
        guest_name = data.get('guestName', '')
        
        if not room_number:
            log(f"객실 번호 없음: {queue_id}")
            mark_as_failed(queue_id, "객실 번호 없음")
            return
        
        action = data.get('action')
        if not action:
            if data.get('checkInDate') and data.get('guestName'):
                action = 'checkin'
            else:
                log(f"액션 타입 없음: {queue_id}")
                mark_as_failed(queue_id, "액션 타입 없음")
                return
        
        execute_pms_automation(room_number, action, guest_name, queue_id)
        
    except Exception as e:
        log(f"처리 오류: {e}")

def main():
    log("=" * 60)
    log(f"PMS Firebase Manager 시작 - {PROPERTY}")
    log("=" * 60)
    
    if not init_firebase():
        log("종료: Firebase 초기화 실패")
        return
    
    status_thread = threading.Thread(target=monitor_room_status, daemon=True)
    status_thread.start()
    log("객실 상태 모니터링 스레드 시작")
    
    ref = db.reference(FIREBASE_PATH)
    ref.listen(on_queue_added)
    
    log(f"리스닝 시작: {FIREBASE_PATH}")
    log("종료: Ctrl+C")
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        log("종료")

if __name__ == "__main__":
    main()

"""
Property 4용 Firebase PMS 리스너
호실 번호: Camp ### 형식
"""

import firebase_admin
from firebase_admin import credentials, db
import subprocess
import os
import time
import re

# ===================================================================
# 설정
# ===================================================================

PROPERTY_NAME = "property4"
PROPERTY_DISPLAY_NAME = "Property 4 (Camp 동)"

# 이 속성에서 처리할 호실 패턴
ROOM_PATTERNS = [
    r'^CAMP\s*\d+$',    # Camp + 숫자 (예: Camp 5, Camp 101, Camp 513)
]

def clean_path(path_str):
    """경로 문자열에서 숨겨진 유니코드 문자 제거"""
    cleaned = path_str.strip()
    cleaned = ''.join(char for char in cleaned if ord(char) < 0x202A or ord(char) > 0x202E)
    return cleaned

# Firebase 설정
FIREBASE_CREDENTIALS_PATH = clean_path(r"C:\PMS\Property4\firebase-service-account.json")
FIREBASE_DATABASE_URL = "https://kiosk-pms-default-rtdb.asia-southeast1.firebasedatabase.app/"

# AutoHotkey 설정
AHK_SCRIPT_PATH = clean_path(r"C:\PMS\Property4\pms_automator.ahk")
AHK_EXE_PATH = clean_path(r"C:\Program Files\AutoHotkey\v1.1.37.02\AutoHotkeyU64.exe")
ROOM_NUMBER_FILE = clean_path(r"C:\PMS\Property4\room_number_data.tmp")

# 로그 파일
LOG_FILE = clean_path(r"C:\PMS\Property4\listener.log")

# ===================================================================
# 유틸리티
# ===================================================================

def log(message):
    """로그 출력 및 파일 저장"""
    timestamp = time.strftime('%Y-%m-%d %H:%M:%S')
    log_message = f"[{timestamp}] [{PROPERTY_NAME}] {message}"
    print(log_message)
    
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(log_message + '\n')
    except:
        pass

def is_valid_room(room_number):
    """이 속성에서 처리 가능한 호실인지 확인"""
    room_upper = room_number.upper().strip()
    for pattern in ROOM_PATTERNS:
        if re.match(pattern, room_upper):
            return True
    return False

# ===================================================================
# Firebase 초기화
# ===================================================================

def init_firebase():
    """Firebase Admin SDK 초기화"""
    try:
        if not os.path.exists(FIREBASE_CREDENTIALS_PATH):
            log(f"❌ Firebase 인증 파일 없음: {FIREBASE_CREDENTIALS_PATH}")
            return False
            
        cred = credentials.Certificate(FIREBASE_CREDENTIALS_PATH)
        firebase_admin.initialize_app(cred, {
            'databaseURL': FIREBASE_DATABASE_URL
        })
        log(f"✓ Firebase 연결 성공")
        return True
    except Exception as e:
        log(f"❌ Firebase 초기화 실패: {e}")
        return False

# ===================================================================
# PMS 자동화
# ===================================================================

def execute_pms_automation(room_number, guest_name, queue_id):
    """AutoHotkey 스크립트 실행"""
    try:
        log(f"체크인 시작: {room_number} ({guest_name})")
        
        # 호실 유효성 검사
        if not is_valid_room(room_number):
            log(f"⚠ 이 속성에서 처리할 수 없는 호실: {room_number}")
            return False
        
        # 필수 파일 확인
        if not os.path.exists(AHK_EXE_PATH):
            log(f"✗ AutoHotkey 실행 파일 없음: {AHK_EXE_PATH}")
            return False
            
        if not os.path.exists(AHK_SCRIPT_PATH):
            log(f"✗ AutoHotkey 스크립트 없음: {AHK_SCRIPT_PATH}")
            return False
        
        # 임시 파일에 호실 번호 저장
        os.makedirs(os.path.dirname(ROOM_NUMBER_FILE), exist_ok=True)
        with open(ROOM_NUMBER_FILE, 'w', encoding='utf-8') as f:
            f.write(room_number)
        
        # AutoHotkey 실행
        command = [AHK_EXE_PATH, AHK_SCRIPT_PATH]
        result = subprocess.run(command, capture_output=True, text=True, timeout=30)
        
        if result.returncode == 0:
            log(f"✓ 체크인 성공: {room_number}")
            mark_as_completed(queue_id)
            return True
        else:
            log(f"✗ 체크인 실패: {room_number} (코드: {result.returncode})")
            if result.stderr:
                log(f"에러: {result.stderr}")
            return False
            
    except Exception as e:
        log(f"✗ 실행 오류: {type(e).__name__} - {str(e)}")
        return False

def mark_as_completed(queue_id):
    """Firebase에서 완료 처리"""
    try:
        ref = db.reference(f'pms_queue/{PROPERTY_NAME}/{queue_id}')
        ref.update({
            'status': 'completed',
            'completedAt': time.strftime('%Y-%m-%dT%H:%M:%S')
        })
        log(f"Firebase 완료 처리: {queue_id}")
    except Exception as e:
        log(f"Firebase 업데이트 실패: {e}")

def on_queue_added(event):
    """Firebase 이벤트 콜백"""
    data = event.data
    queue_id = event.path.strip('/')
    
    if data and data.get('status') == 'pending':
        room_number = data.get('roomNumber', '')
        guest_name = data.get('guestName', '')
        
        if room_number:
            execute_pms_automation(room_number, guest_name, queue_id)

# ===================================================================
# 메인
# ===================================================================

def main():
    print("=" * 60)
    print(f"{PROPERTY_DISPLAY_NAME} - PMS Firebase Listener")
    print("=" * 60)
    
    if not init_firebase():
        log("종료: Firebase 초기화 실패")
        return
    
    # 속성별 큐 리스닝
    ref = db.reference(f'pms_queue/{PROPERTY_NAME}')
    ref.listen(on_queue_added)
    
    log(f"실시간 리스닝 시작 (경로: pms_queue/{PROPERTY_NAME})")
    log(f"처리 가능 호실: {', '.join(ROOM_PATTERNS)}")
    log("종료: Ctrl+C")
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        log("종료")

if __name__ == "__main__":
    main()

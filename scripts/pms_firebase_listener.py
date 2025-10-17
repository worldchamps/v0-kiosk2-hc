"""
Firebase Realtime Database를 사용한 PMS 리스너
실시간으로 체크인 알림을 받아 AutoHotkey 스크립트를 실행합니다.
"""

import firebase_admin
from firebase_admin import credentials, db
import subprocess
import os
import time

# ===================================================================
# 설정
# ===================================================================

def clean_path(path_str):
    """경로 문자열에서 숨겨진 유니코드 문자 제거"""
    # 일반적인 공백과 제어 문자 제거
    cleaned = path_str.strip()
    # 유니코드 제어 문자 제거 (U+202A 등)
    cleaned = ''.join(char for char in cleaned if ord(char) < 0x202A or ord(char) > 0x202E)
    return cleaned

# Firebase 설정 (Firebase Console에서 다운로드한 서비스 계정 키 파일)
# 주의: 경로를 직접 타이핑하세요. 복사-붙여넣기 시 숨겨진 문자가 포함될 수 있습니다.
# 예시: C:\PMS\firebase-service-account.json
FIREBASE_CREDENTIALS_PATH = clean_path(r"C:\PMS\firebase-service-account.json")  # 실제 경로로 변경

# Firebase Console > Realtime Database > 데이터 탭에서 URL 확인
# 예시: https://your-project-id-default-rtdb.firebaseio.com
FIREBASE_DATABASE_URL = "https://kiosk-pms-default-rtdb.asia-southeast1.firebasedatabase.app/"  # 실제 URL로 변경

# AutoHotkey 스크립트 경로
AHK_SCRIPT_PATH = clean_path(r"C:\Users\USER\Documents\AutoHotkey\pms_automator.ahk")
AHK_EXE_PATH = clean_path(r"C:\Program Files\AutoHotkey\AutoHotkey.exe")

# 임시 파일 경로 (AutoHotkey가 읽을 호실 번호 파일)
ROOM_NUMBER_FILE = clean_path(r"C:\Users\USER\Documents\AutoHotkey\room_number_data.tmp")

# ===================================================================
# Firebase 초기화
# ===================================================================

def init_firebase():
    """Firebase Admin SDK 초기화"""
    try:
        if FIREBASE_DATABASE_URL == "https://your-project.firebaseio.com":
            print("[PMS Listener] ❌ 오류: Firebase Database URL이 설정되지 않았습니다!")
            print("[PMS Listener]")
            print("[PMS Listener] Firebase Console에서 Database URL을 확인하세요:")
            print("[PMS Listener] 1. Firebase Console 접속: https://console.firebase.google.com")
            print("[PMS Listener] 2. 프로젝트 선택")
            print("[PMS Listener] 3. 왼쪽 메뉴 > Realtime Database 클릭")
            print("[PMS Listener] 4. 데이터 탭에서 URL 확인 (예: https://xxx-default-rtdb.firebaseio.com)")
            print("[PMS Listener] 5. 스크립트의 FIREBASE_DATABASE_URL 변수에 복사")
            print("[PMS Listener]")
            return False
        
        if not os.path.exists(FIREBASE_CREDENTIALS_PATH):
            print(f"[PMS Listener] ❌ 오류: Firebase 인증 파일을 찾을 수 없습니다.")
            print(f"[PMS Listener] 경로: {FIREBASE_CREDENTIALS_PATH}")
            print(f"[PMS Listener]")
            print(f"[PMS Listener] Firebase 서비스 계정 키 파일 다운로드:")
            print(f"[PMS Listener] 1. Firebase Console > 프로젝트 설정 (톱니바퀴)")
            print(f"[PMS Listener] 2. 서비스 계정 탭")
            print(f"[PMS Listener] 3. '새 비공개 키 생성' 클릭")
            print(f"[PMS Listener] 4. 다운로드한 JSON 파일을 위 경로에 저장")
            print(f"[PMS Listener]")
            return False
            
        cred = credentials.Certificate(FIREBASE_CREDENTIALS_PATH)
        firebase_admin.initialize_app(cred, {
            'databaseURL': FIREBASE_DATABASE_URL
        })
        print("[PMS Listener] ✓ Firebase 연결 성공!")
        print(f"[PMS Listener] 인증 파일: {FIREBASE_CREDENTIALS_PATH}")
        print(f"[PMS Listener] 데이터베이스: {FIREBASE_DATABASE_URL}")
        return True
    except Exception as e:
        print(f"[PMS Listener] ❌ Firebase 초기화 실패: {e}")
        print(f"[PMS Listener] 설정을 다시 확인하세요.")
        return False

# ===================================================================
# PMS 자동화 실행
# ===================================================================

def execute_pms_automation(room_number, guest_name, queue_id):
    """
    AutoHotkey 스크립트를 실행하여 PMS 체크인 자동화
    
    Args:
        room_number: 객실 번호 (예: "B521")
        guest_name: 투숙객명
        queue_id: Firebase Queue ID
    """
    try:
        print(f"\n[PMS Listener] 체크인 처리 시작: {room_number} ({guest_name})")
        
        # 1. 호실 번호를 임시 파일에 저장
        with open(ROOM_NUMBER_FILE, 'w', encoding='utf-8') as f:
            f.write(room_number)
        
        # 2. AutoHotkey 스크립트 실행
        result = subprocess.run(
            [AHK_EXE_PATH, AHK_SCRIPT_PATH],
            capture_output=True,
            text=True,
            timeout=30  # 30초 타임아웃
        )
        
        # 3. 실행 결과 확인
        if result.returncode == 0:
            print(f"[PMS Listener] ✓ 체크인 성공: {room_number}")
            # Firebase에서 완료 처리
            mark_as_completed(queue_id)
            return True
        else:
            print(f"[PMS Listener] ✗ 체크인 실패: {room_number}")
            print(f"[PMS Listener] 오류: {result.stdout}")
            return False
            
    except subprocess.TimeoutExpired:
        print(f"[PMS Listener] ✗ 타임아웃: {room_number} (30초 초과)")
        return False
    except Exception as e:
        print(f"[PMS Listener] ✗ 실행 오류: {e}")
        return False

# ===================================================================
# Firebase 데이터 처리
# ===================================================================

def mark_as_completed(queue_id):
    """Firebase에서 큐 항목을 완료 처리"""
    try:
        ref = db.reference(f'pms_queue/{queue_id}')
        ref.update({
            'status': 'completed',
            'completedAt': time.strftime('%Y-%m-%dT%H:%M:%S')
        })
        print(f"[PMS Listener] Firebase 완료 처리: {queue_id}")
    except Exception as e:
        print(f"[PMS Listener] Firebase 업데이트 실패: {e}")

def on_queue_added(event):
    """
    Firebase에 새 체크인이 추가되면 호출되는 콜백
    
    Args:
        event: Firebase 이벤트 객체
    """
    data = event.data
    queue_id = event.path.strip('/')
    
    # pending 상태인 항목만 처리
    if data and data.get('status') == 'pending':
        room_number = data.get('roomNumber', '')
        guest_name = data.get('guestName', '')
        
        if room_number:
            execute_pms_automation(room_number, guest_name, queue_id)

# ===================================================================
# 메인 실행
# ===================================================================

def main():
    """메인 실행 함수"""
    print("=" * 60)
    print("PMS Firebase Listener 시작")
    print("=" * 60)
    
    # Firebase 초기화
    if not init_firebase():
        print("[PMS Listener] 종료: Firebase 초기화 실패")
        return
    
    # PMS Queue 리스너 등록
    ref = db.reference('pms_queue')
    ref.listen(on_queue_added)
    
    print("[PMS Listener] 실시간 리스닝 시작...")
    print("[PMS Listener] 종료하려면 Ctrl+C를 누르세요.")
    
    try:
        # 무한 대기 (Firebase가 백그라운드에서 이벤트 처리)
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[PMS Listener] 종료 중...")

if __name__ == "__main__":
    main()

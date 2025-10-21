#Requires AutoHotkey v1.1
#Persistent

; ===============================================================
; 설정: 파일 경로
; ===============================================================
IniFile := "C:\PMS\Property2\pms_coordinates_property2.ini"
TriggerFile := "C:\PMS\Property2\trigger.txt"
LogFile := "C:\PMS\Property2\ahk_log.txt"

; ===============================================================
; 로그 함수
; ===============================================================
Log(message) {
    global LogFile
    FormatTime, timestamp, , yyyy-MM-dd HH:mm:ss
    logMessage := "[" . timestamp . "] " . message . "`n"
    ; FileAppend 대신 파일 핸들 사용하여 메모장 열림 방지
    FileAppend, %logMessage%, %LogFile%
    return
}

; 시작 로그
FileAppend, ========== AHK 스크립트 시작 ==========`n, %LogFile%

; ===============================================================
; 트리거 파일 모니터링 (1초마다 체크)
; ===============================================================
SetTimer, CheckTriggerFile, 1000
return

CheckTriggerFile:
    IfExist, %TriggerFile%
    {
        FileAppend, [트리거 감지] 매크로 실행 시작`n, %LogFile%
        
        ; 매크로 실행
        Gosub, RunMyMacro
        
        ; 트리거 파일 삭제
        FileDelete, %TriggerFile%
        FileAppend, [트리거 삭제] 처리 완료`n, %LogFile%
    }
return

; ===============================================================
; 실제 실행할 매크로 코드
; ===============================================================
RunMyMacro:
    ; --- 0. INI 파일 존재 여부 확인 ---
    IfNotExist, %IniFile%
    {
        FileAppend, [오류] INI 파일 없음: %IniFile%`n, %LogFile%
        MsgBox, 48, 오류, INI 파일을 찾을 수 없습니다.`n%IniFile%
        return
    }

    ; --- 1. matrix.exe 활성화 ---
    FileAppend, [1단계] matrix.exe 활성화 시도`n, %LogFile%
    WinActivate, ahk_exe matrix.exe
    WinWaitActive, ahk_exe matrix.exe, , 3
    if ErrorLevel
    {
        FileAppend, [오류] matrix.exe 활성화 실패`n, %LogFile%
        MsgBox, 48, 오류, matrix.exe를 활성화할 수 없습니다.
        return 
    }
    
    FileAppend, [1단계] matrix.exe 활성화 성공`n, %LogFile%
    Sleep, 200

    ; --- 2. INI 파일에서 네비게이션 좌표 읽기 ---
    IniRead, OpenRoomListMenuX, %IniFile%, Navigation, OpenRoomListMenu_X
    IniRead, OpenRoomListMenuY, %IniFile%, Navigation, OpenRoomListMenu_Y
    IniRead, OpenRoomListCommandX, %IniFile%, Navigation, OpenRoomListCommand_X
    IniRead, OpenRoomListCommandY, %IniFile%, Navigation, OpenRoomListCommand_Y

    ; --- 3. 객실 조회 창 띄우기 ---
    Click, %OpenRoomListMenuX%, %OpenRoomListMenuY%
    FileAppend, [2단계] 메뉴 클릭: %OpenRoomListMenuX%`, %OpenRoomListMenuY%`n, %LogFile%
    Sleep, 200
    
    Click, %OpenRoomListCommandX%, %OpenRoomListCommandY%
    FileAppend, [2단계] 객실 목록 명령 클릭`n, %LogFile%
    Sleep, 1500

    ; --- 4. 객실상태 조회 창 활성화 ---
    WinActivate, 객실상태 조회
    WinWaitActive, 객실상태 조회, , 3
    if ErrorLevel
    {
        FileAppend, [오류] 객실 상태 조회 창 활성화 실패`n, %LogFile%
        MsgBox, 48, 오류, 객실 상태 조회 창을 활성화할 수 없습니다.
        return
    }
    
    FileAppend, [3단계] 객실 상태 조회 창 활성화 성공`n, %LogFile%

    ; Window 좌표 모드 설정
    CoordMode, Mouse, Window

    ; --- 5. 객실 목록 순회 및 더블 클릭 ---
    ; 배열을 문자열로 변경하여 AHK v1 호환성 확보
    Rooms := "202,203,205,206,207,208,301,302,303,305,306,307,308,501,502,503,505,506,507,508,601,602,603,605"
    
    FileAppend, [4단계] 객실 순회 시작`n, %LogFile%
    
    Loop, Parse, Rooms, `,
    {
        roomNumber := A_LoopField
        
        ; INI에서 좌표 읽기
        IniRead, RoomX, %IniFile%, Rooms, Kariv %roomNumber%_X
        IniRead, RoomY, %IniFile%, Rooms, Kariv %roomNumber%_Y

        if (RoomX = "ERROR" or RoomY = "ERROR")
        {
            FileAppend, [경고] 좌표 읽기 실패: Kariv %roomNumber%`n, %LogFile%
            continue
        }

        FileAppend, [처리중] Kariv %roomNumber% (%RoomX%`, %RoomY%)`n, %LogFile%
        
        ; 마우스 이동 및 더블 클릭
        MouseMove, %RoomX%, %RoomY%
        Sleep, 200
        Click, 2
        Sleep, 1000
    }

    FileAppend, [4단계] 객실 순회 완료`n, %LogFile%

    ; 마우스 좌표 모드 복원
    CoordMode, Mouse, Screen

    ; --- 6. 창 닫기 ---
    IniRead, CloseRoomListX, %IniFile%, Navigation, CloseRoomList_X
    IniRead, CloseRoomListY, %IniFile%, Navigation, CloseRoomList_Y
    IniRead, CloseMainX, %IniFile%, Navigation, CloseMain_X
    IniRead, CloseMainY, %IniFile%, Navigation, CloseMain_Y
    
    Sleep, 500
    Click, %CloseRoomListX%, %CloseRoomListY%
    FileAppend, [5단계] 객실 목록 창 닫기`n, %LogFile%
    Sleep, 200
    
    Click, %CloseMainX%, %CloseMainY%
    FileAppend, [5단계] 메인 창 닫기`n, %LogFile%
    Sleep, 200

    FileAppend, [완료] 매크로 완료`n, %LogFile%
return

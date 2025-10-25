#Requires AutoHotkey v1.1
#Persistent

; ===============================================================
; 설정: 파일 경로
; ===============================================================
TriggerFile := "C:\PMS\Property2\trigger.txt"
LogFile := "C:\PMS\Property2\ahk_log.txt"

; ===============================================================
; 로그 함수
; ===============================================================
Log(message) {
    global LogFile
    FormatTime, timestamp, , yyyy-MM-dd HH:mm:ss
    logMessage := "[" . timestamp . "] " . message . "`n"
    FileAppend, %logMessage%, %LogFile%
    return
}

; 시작 로그 및 알림
FileAppend, ========== AHK 스크립트 시작 ==========`n, %LogFile%
TrayTip, Property2 PMS Automator, 스크립트가 시작되었습니다.`n트리거 파일 대기 중..., 3, 1

; ===============================================================
; 트리거 파일 모니터링 (1초마다 체크)
; ===============================================================
SetTimer, CheckTriggerFile, 1000
return

CheckTriggerFile:
    IfExist, %TriggerFile%
    {
        FileAppend, [트리거 감지] 매크로 실행 시작`n, %LogFile%
        TrayTip, Property2 PMS Automator, 트리거 파일 감지!`n매크로 실행 중..., 2, 1
        
        Gosub, RunMyMacro
        
        FileDelete, %TriggerFile%
        FileAppend, [트리거 삭제] 처리 완료`n, %LogFile%
        
        TrayTip, Property2 PMS Automator, 매크로 실행 완료!, 2, 1
    }
return

; ===============================================================
; 수동 실행 핫키 (Ctrl+Alt+R) - 테스트용 202호
; ===============================================================
^!r::
    FileAppend, [수동 실행] Ctrl+Alt+R 눌림 (202호 테스트)`n, %LogFile%
    TrayTip, Property2 PMS Automator, 수동 실행 시작! (202호), 2, 1
    targetRoom := "202"
    Gosub, RunMyMacro
return

; ===============================================================
; 실제 실행할 매크로 코드
; ===============================================================
RunMyMacro:
    ; 트리거 파일에서 객실 번호 읽기
    global TriggerFile
    global LogFile
    global targetRoom
    
    ; 트리거 파일이 있으면 객실 번호 읽기
    IfExist, %TriggerFile%
    {
        FileRead, triggerContent, %TriggerFile%
        FileAppend, [트리거 내용] %triggerContent%`n, %LogFile%
        
        ; JSON에서 room_number 추출 (간단한 파싱)
        ; "room_number": "Kariv 506" 형식에서 506 추출
        if RegExMatch(triggerContent, """room_number"":\s*""Kariv\s*(\d+)""", match) {
            targetRoom := match1
            FileAppend, [파싱 성공] 대상 객실: %targetRoom%`n, %LogFile%
        } else {
            FileAppend, [파싱 실패] 기본값 202호 사용`n, %LogFile%
            targetRoom := "202"
        }
    }
    
    ; targetRoom이 설정되지 않았으면 202호 기본값
    if (targetRoom = "") {
        targetRoom := "202"
        FileAppend, [기본값] 202호로 설정`n, %LogFile%
    }
    
    FileAppend, [실행 대상] Kariv %targetRoom%`n, %LogFile%
    
    ; 네비게이션 좌표
    OpenRoomListMenuX := 187
    OpenRoomListMenuY := 39
    OpenRoomListCommandX := 240
    OpenRoomListCommandY := 170
    CloseRoomListX := 1026
    CloseRoomListY := 592
    CloseMainX := 936
    CloseMainY := 863

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

    ; --- 2. 객실 조회 창 띄우기 ---
    Click, %OpenRoomListMenuX%, %OpenRoomListMenuY%
    FileAppend, [2단계] 메뉴 클릭: %OpenRoomListMenuX%`, %OpenRoomListMenuY%`n, %LogFile%
    Sleep, 200
    
    Click, %OpenRoomListCommandX%, %OpenRoomListCommandY%
    FileAppend, [2단계] 객실 목록 명령 클릭`n, %LogFile%
    Sleep, 1500

    ; --- 3. 객실상태 조회 창 활성화 ---
    WinWait, 객실상태 조회, , 3
    if ErrorLevel
    {
        FileAppend, [오류] 객실 상태 창을 조회 할수 없습니다`n, %LogFile%
        MsgBox, 객실 상태 창을 조회 할수 없습니다
        return
    }
    
    WinActivate, 객실상태 조회
    FileAppend, [3단계] 객실 상태 조회 창 활성화 성공`n, %LogFile%

    ; Window 좌표 모드 설정
    CoordMode, Mouse, Window

    ; 대상 객실만 처리
    FileAppend, [4단계] 대상 객실 처리: Kariv %targetRoom%`n, %LogFile%
    
    ; 객실 번호에 따른 좌표 매핑
    if (targetRoom = "202") {
        roomX := 55
        roomY := 127
    } else if (targetRoom = "203") {
        roomX := 55
        roomY := 150
    } else if (targetRoom = "205") {
        roomX := 55
        roomY := 173
    } else if (targetRoom = "206") {
        roomX := 55
        roomY := 196
    } else if (targetRoom = "207") {
        roomX := 55
        roomY := 219
    } else if (targetRoom = "208") {
        roomX := 55
        roomY := 242
    } else if (targetRoom = "301") {
        roomX := 55
        roomY := 265
    } else if (targetRoom = "302") {
        roomX := 55
        roomY := 288
    } else if (targetRoom = "303") {
        roomX := 55
        roomY := 311
    } else if (targetRoom = "305") {
        roomX := 55
        roomY := 334
    } else if (targetRoom = "306") {
        roomX := 55
        roomY := 357
    } else if (targetRoom = "307") {
        roomX := 55
        roomY := 380
    } else if (targetRoom = "308") {
        roomX := 55
        roomY := 403
    } else if (targetRoom = "501") {
        roomX := 55
        roomY := 426
    } else if (targetRoom = "502") {
        roomX := 55
        roomY := 449
    } else if (targetRoom = "503") {
        roomX := 55
        roomY := 472
    } else if (targetRoom = "505") {
        roomX := 55
        roomY := 495
    } else if (targetRoom = "506") {
        roomX := 55
        roomY := 518
    } else if (targetRoom = "507") {
        roomX := 55
        roomY := 541
    } else if (targetRoom = "508") {
        roomX := 55
        roomY := 564
    } else if (targetRoom = "601") {
        roomX := 55
        roomY := 587
    } else if (targetRoom = "602") {
        roomX := 55
        roomY := 610
    } else if (targetRoom = "603") {
        roomX := 55
        roomY := 633
    } else if (targetRoom = "605") {
        roomX := 55
        roomY := 656
    } else {
        FileAppend, [오류] 알 수 없는 객실 번호: %targetRoom%`n, %LogFile%
        MsgBox, 알 수 없는 객실 번호: %targetRoom%
        return
    }
    
    ; 대상 객실 더블 클릭
    FileAppend, [처리중] Kariv %targetRoom% (%roomX%`, %roomY%)`n, %LogFile%
    MouseMove, %roomX%, %roomY%
    Sleep, 200
    Click, 2
    Sleep, 1000

    FileAppend, [4단계] 객실 처리 완료`n, %LogFile%

    ; 마우스 좌표 모드 복원
    CoordMode, Mouse, Screen

    ; --- 5. 창 닫기 ---
    Sleep, 500
    Click, %CloseRoomListX%, %CloseRoomListY%
    FileAppend, [5단계] 객실 목록 창 닫기`n, %LogFile%
    Sleep, 200
    
    Click, %CloseMainX%, %CloseMainY%
    FileAppend, [5단계] 메인 창 닫기`n, %LogFile%
    Sleep, 200

    FileAppend, [완료] 매크로 완료`n, %LogFile%
    
    ; targetRoom 초기화
    targetRoom := ""
return

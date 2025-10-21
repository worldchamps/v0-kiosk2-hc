#Requires AutoHotkey v1.1
#Persistent

; ===============================================================
; 트리거 파일 경로
; ===============================================================
TriggerFile := "C:\PMS\Property2\trigger.txt"

; ===============================================================
; 1초마다 트리거 파일 체크
; ===============================================================
SetTimer, CheckTrigger, 1000

; ===============================================================
; Ctrl+Alt+R 단축키로 수동 실행
; ===============================================================
^!r::
    TrayTip, 테스트, 수동 실행 시작!, 2
    Gosub, RunMyMacro
return

return

; ===============================================================
; 트리거 파일 체크
; ===============================================================
CheckTrigger:
    IfExist, %TriggerFile%
    {
        TrayTip, 테스트, 트리거 파일 감지! 매크로 실행 시작, 2
        FileDelete, %TriggerFile%
        Gosub, RunMyMacro
    }
return

; ===============================================================
; 실제 매크로 실행
; ===============================================================
RunMyMacro:
    ; --- 1. matrix.exe 활성화 ---
    WinActivate, ahk_exe matrix.exe
    WinWaitActive, ahk_exe matrix.exe, , 3
    if ErrorLevel
    {
        TrayTip, 오류, matrix.exe를 활성화할 수 없습니다., 3, 16
        return 
    }
    
    Sleep, 200
    
    ; --- 2. 객실 조회 메뉴 열기 ---
    Click, 187, 39
    Sleep, 200
    Click, 240, 170
    Sleep, 1500
    
    ; --- 3. 객실상태 조회 창 활성화 ---
    WinTitle := "객실상태 조회"
    WinActivate, %WinTitle%
    WinWaitActive, %WinTitle%, , 3
    if ErrorLevel
    {
        TrayTip, 오류, 객실 상태 조회 창을 활성화할 수 없습니다., 3, 16
        return
    }
    
    ; --- 4. 202호 더블 클릭 (하드코딩된 좌표) ---
    CoordMode, Mouse, Window
    TestClickX := 55
    TestClickY := 127
    
    MouseMove, %TestClickX%, %TestClickY%
    Click, 1
    Sleep, 50
    Click, 1
    
    CoordMode, Mouse, Screen
    Sleep, 1000
    
    ; --- 5. 창 닫기 ---
    Click, 1026, 592
    Sleep, 200
    Click, 936, 863
    Sleep, 200
    
    TrayTip, 완료, 매크로 실행 완료!, 2, 1
return

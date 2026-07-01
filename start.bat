@echo off
setlocal
cd /d "%~dp0"
title AGAIN Kiosk Launcher

echo.
echo ==============================================
echo          Starting AGAIN Kiosk System
echo ==============================================
echo.

if not exist ".env.local" (
    echo [ERROR] .env.local file not found.
    echo Please copy the kiosk environment file into this folder.
    pause
    exit /b 1
)

if not exist ".next\BUILD_ID" (
    echo [0/4] Next.js build not found. Building now...
    call npm run build
    if errorlevel 1 (
        echo [ERROR] Build failed.
        pause
        exit /b 1
    )
    echo.
)

echo [1/4] Starting Hardware Server...
pushd hardware_server
start "AGAIN Hardware Server" /min cmd /k "python -m pip install -r requirements.txt && python main.py"
popd

echo [2/4] Starting Next.js Server...
start "AGAIN Web Server" /min cmd /k "npm run start"

echo [3/4] Waiting for Next.js server on http://localhost:3000 ...
call npx wait-on http://localhost:3000 --timeout 120000
if errorlevel 1 (
    echo [ERROR] Next.js server did not start within 120 seconds.
    pause
    exit /b 1
)

echo [4/4] Starting Electron kiosk...
set KIOSK_WINDOW_MODE=true
set KIOSK_START_LOCATION=D
start "Electron Kiosk" cmd /c "npx electron ."

echo.
echo ==============================================
echo             Kiosk is Running
echo ==============================================
echo D building: http://localhost:3000/kiosk/D
echo.
timeout /t 5 >nul
exit /b 0

@echo off
setlocal
cd /d "%~dp0"
title AGAIN Kiosk Launcher

echo.
echo ==============================================
echo          Starting AGAIN Kiosk System
echo ==============================================
echo.

if not exist ".next\BUILD_ID" (
    echo [0/2] Next.js build not found. Building now...
    echo       This may take 1-2 minutes on first run.
    call npm run build
    if errorlevel 1 (
        echo ERROR: Build failed. Check the errors above.
        pause
        exit /b 1
    )
    echo Build completed successfully.
    echo.
)

rem Electron starts the hardware server after loading .env.local.
echo [1/2] Starting Next.js Server...
start "AGAIN Web Server" /min cmd /k "npm run start"

echo [2/2] Waiting for Next.js server on http://localhost:3000 ...
call npx wait-on http://localhost:3000 --timeout 120000
if errorlevel 1 (
    echo ERROR: Next.js server did not start within 120 seconds.
    pause
    exit /b 1
)

echo Launching Electron interface...
set KIOSK_WINDOW_MODE=true
start "Electron Kiosk" cmd /c "npx electron ."

echo.
echo ==============================================
echo             Kiosk is Running
echo ==============================================
echo To close, exit the Electron window.
echo.
timeout /t 5 >nul
exit /b 0

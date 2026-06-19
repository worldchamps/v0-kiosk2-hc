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
    echo [0/3] Next.js build not found. Building now...
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

echo [1/3] Starting Hardware Server...
pushd hardware_server
python -m pip uninstall -y asyncio >nul 2>&1
start "AGAIN Hardware Server" /min cmd /k "python main.py"
popd

echo [2/3] Starting Next.js Server...
start "AGAIN Web Server" /min cmd /k "npm run start"

echo [3/3] Waiting for Next.js server on http://localhost:3000 ...
call npx wait-on http://localhost:3000 --timeout 120000
if errorlevel 1 (
    echo ERROR: Next.js server did not start within 120 seconds.
    pause
    exit /b 1
)

echo Launching Electron interface...
start "Electron Kiosk" cmd /c "npx electron ."

echo.
echo ==============================================
echo             Kiosk is Running
echo ==============================================
echo To close, exit the Electron window.
echo.
timeout /t 5 >nul
exit /b 0

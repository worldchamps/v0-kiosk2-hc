@echo off
echo ====================================
echo Starting Kiosk Application
echo ====================================
echo.

echo [1/3] Building Next.js application...
call npm run build
if %errorlevel% neq 0 (
    echo Build failed!
    pause
    exit /b %errorlevel%
)

echo.
echo [2/3] Starting Next.js server in new window...
start "Next.js Server" cmd /k "npm run start"

echo.
echo [3/3] Waiting 5 seconds for server to start...
timeout /t 5 /nobreak

echo Starting Electron application in new window...
start "Electron Kiosk" cmd /k "npm run electron"

echo.
echo ====================================
echo Kiosk application started!
echo ====================================
echo.
echo Close this window to keep the app running.
pause

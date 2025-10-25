@echo off
echo ========================================
echo Starting Kiosk (No Build)
echo ========================================
echo.

echo Starting Next.js server...
start "Next.js Server" cmd /k "npm run start"

echo Waiting for server to start...
timeout /t 5 /nobreak

echo Starting Electron app...
start "Electron Kiosk" cmd /k "npm run electron"

echo.
echo ========================================
echo Kiosk started successfully!
echo ========================================
pause

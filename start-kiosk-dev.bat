@echo off
echo ====================================
echo Starting Kiosk Application (Dev Mode)
echo ====================================
echo.

echo [1/2] Starting Next.js dev server in new window...
start "Next.js Dev Server" cmd /k "npm run dev"

echo.
echo [2/2] Waiting 10 seconds for dev server to start...
timeout /t 10 /nobreak

echo Starting Electron application in new window...
start "Electron Kiosk" cmd /k "npm run electron"

echo.
echo ====================================
echo Kiosk application started in dev mode!
echo ====================================
echo.
echo Close this window to keep the app running.
pause

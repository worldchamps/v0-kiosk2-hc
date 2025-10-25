@echo off
echo ========================================
echo Starting Kiosk Application
echo ========================================
echo.

echo Loading environment variables from .env.local...
echo Starting Electron app...
echo.

call npm run electron

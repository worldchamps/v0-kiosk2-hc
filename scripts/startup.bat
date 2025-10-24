@echo off
echo ========================================
echo TheBeachStay Kiosk Startup Script
echo ========================================
echo.

echo [1/3] Building application...
call npm run build
if %errorlevel% neq 0 (
    echo Build failed!
    pause
    exit /b %errorlevel%
)
echo Build completed!
echo.

echo [2/3] Starting Next.js server...
start "Next.js Server" cmd /k "npm run start"
echo Server starting in new window...
echo.

echo [3/3] Waiting 5 seconds for server to initialize...
timeout /t 5 /nobreak > nul
echo.

echo Starting Electron app...
start "Electron App" cmd /k "npm run electron"
echo.

echo ========================================
echo All processes started successfully!
echo ========================================
pause

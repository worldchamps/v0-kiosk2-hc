@echo off
setlocal
cd /d "%~dp0"
title Kiosk Build Setup

echo.
echo ==============================================
echo      AGAIN Kiosk - Installation ^& Build
echo ==============================================
echo.

echo [1/2] Installing Hardware Server Dependencies...
pushd hardware_server
python -m pip install -r requirements.txt
if errorlevel 1 (
    echo [ERROR] Failed to install Python requirements.
    popd
    pause
    exit /b 1
)
popd

echo.
echo [2/2] Building Kiosk Frontend...
echo Installing Node modules...
call npm install
if errorlevel 1 (
    echo [ERROR] Failed to install Node modules.
    pause
    exit /b 1
)
echo Building Next.js application...
call npm run build
if errorlevel 1 (
    echo [ERROR] Failed to build frontend.
    pause
    exit /b 1
)

echo.
echo ==============================================
echo           Setup Completed Successfully!
echo ==============================================
echo.
echo Run run_kiosk_auto.bat to start the kiosk.
pause

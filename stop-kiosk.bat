@echo off
echo ====================================
echo Stopping Kiosk Application
echo ====================================
echo.

echo Killing Node.js processes...
taskkill /F /IM node.exe /T 2>nul
if %errorlevel% equ 0 (
    echo Node.js processes stopped.
) else (
    echo No Node.js processes found.
)

echo.
echo Killing Electron processes...
taskkill /F /IM electron.exe /T 2>nul
if %errorlevel% equ 0 (
    echo Electron processes stopped.
) else (
    echo No Electron processes found.
)

echo.
echo ====================================
echo Kiosk application stopped!
echo ====================================
pause

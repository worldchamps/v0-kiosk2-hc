@echo off
echo ========================================
echo Clean Install Script
echo ========================================
echo.

echo [1/4] Removing old files...
if exist node_modules rmdir /s /q node_modules
if exist .next rmdir /s /q .next
if exist out rmdir /s /q out
if exist package-lock.json del package-lock.json
echo Old files removed.
echo.

echo [2/4] Cleaning npm cache...
call npm cache clean --force
echo.

echo [3/4] Installing dependencies...
call npm install
echo.

echo [4/4] Building application...
call npm run build
echo.

if %ERRORLEVEL% EQU 0 (
    echo ========================================
    echo Clean install completed successfully!
    echo Run start.bat to launch the application
    echo ========================================
) else (
    echo ========================================
    echo Installation failed! Check errors above.
    echo ========================================
)

echo.
pause

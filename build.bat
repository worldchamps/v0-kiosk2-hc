@echo off
echo ========================================
echo Kiosk Build Script
echo ========================================
echo.

echo [1/3] Cleaning build cache...
if exist .next rmdir /s /q .next
if exist out rmdir /s /q out
echo Build cache cleaned.
echo.

echo [2/3] Building Next.js application...
call npm run build
echo.

if %ERRORLEVEL% EQU 0 (
    echo [3/3] Build completed successfully!
    echo.
    echo ========================================
    echo You can now run start.bat to launch the app
    echo ========================================
) else (
    echo.
    echo ========================================
    echo Build failed! Check the error messages above.
    echo ========================================
)

echo.
pause

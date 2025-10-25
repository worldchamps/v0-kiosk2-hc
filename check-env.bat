@echo off
chcp 65001 >nul
echo ========================================
echo 환경변수 진단 도구
echo ========================================
echo.

echo [1] .env.local 파일 존재 확인
if exist .env.local (
    echo ✓ .env.local 파일 있음
) else (
    echo ✗ .env.local 파일 없음!
    pause
    exit /b 1
)
echo.

echo [2] .env.local 파일 인코딩 확인
powershell -Command "$content = Get-Content .env.local -Encoding UTF8 -ErrorAction SilentlyContinue; if ($content) { Write-Host '✓ UTF-8로 읽기 성공' } else { Write-Host '✗ UTF-8로 읽기 실패 - ANSI 인코딩일 수 있음' }"
echo.

echo [3] 필수 환경변수 확인
node -e "require('dotenv').config({ path: '.env.local' }); const required = ['KIOSK_PROPERTY_ID', 'NEXT_PUBLIC_KIOSK_PROPERTY_ID', 'FIREBASE_DATABASE_URL', 'NEXT_PUBLIC_FIREBASE_DATABASE_URL', 'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']; let missing = []; required.forEach(key => { if (!process.env[key]) { missing.push(key); console.log('✗', key, '없음'); } else { console.log('✓', key, '있음'); } }); if (missing.length > 0) { console.log('\n누락된 환경변수:', missing.join(', ')); process.exit(1); } else { console.log('\n모든 필수 환경변수 확인 완료!'); }"

echo.
echo ========================================
echo 진단 완료
echo ========================================
pause

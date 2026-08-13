@echo off
setlocal
cd /d "%~dp0"

set "OUTPUT=toss-front-plugin-v7.zip"
if exist "%OUTPUT%" del "%OUTPUT%"

powershell -NoProfile -Command ^
  "Compress-Archive -Path 'index.html','settings.html','global.css','sdk.js','config.js','plugin.js' -DestinationPath '%OUTPUT%'"

if errorlevel 1 (
  echo [ERROR] Failed to create %OUTPUT%.
  exit /b 1
)

echo Created %OUTPUT%

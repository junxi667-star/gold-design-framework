@echo off
setlocal
for %%I in ("%~dp0..\..\..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%"
set "BINARY=%PROJECT_ROOT%\jewelchain-server.exe"
if not exist "%BINARY%" (
  echo ERROR: jewelchain-server.exe is missing. Build with: go build -o jewelchain-server.exe ./cmd/jewelchain-server
  pause
  exit /b 1
)
echo Starting diagnostic check...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:4173/api/health' -UseBasicParsing -TimeoutSec 5; Write-Host 'Health:' $r.Content } catch { Write-Host 'Server not running or not responding' }"
pause

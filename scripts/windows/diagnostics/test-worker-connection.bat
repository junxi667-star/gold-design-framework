@echo off
setlocal
for %%I in ("%~dp0..\..\..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%"
echo Testing worker connection...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:4173/api/v1/workers/status' -UseBasicParsing -TimeoutSec 5; Write-Host 'Worker Status:' $r.Content } catch { Write-Host 'Server not running or not responding' }"
pause

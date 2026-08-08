@echo off
setlocal
for %%I in ("%~dp0..\..\..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%"
set "BINARY=%PROJECT_ROOT%\jewelchain-worker.exe"
if not exist "%BINARY%" (
  echo ERROR: jewelchain-worker.exe is missing. Build with: go build -o jewelchain-worker.exe ./cmd/jewelchain-worker
  pause
  exit /b 1
)
"%BINARY%"
pause

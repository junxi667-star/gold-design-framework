@echo off
setlocal EnableExtensions
for %%I in ("%~dp0..\..\..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%"
title JewelChain Studio v1.3.1

if not exist "%PROJECT_ROOT%\jewelchain-server.exe" (
  echo ERROR: jewelchain-server.exe is missing. Build with: go build -o jewelchain-server.exe ./cmd/jewelchain-server
  pause
  exit /b 1
)
if not exist "%PROJECT_ROOT%\jewelchain-worker.exe" (
  echo ERROR: jewelchain-worker.exe is missing. Build with: go build -o jewelchain-worker.exe ./cmd/jewelchain-worker
  pause
  exit /b 1
)
if not exist "%PROJECT_ROOT%\.env" (
  echo ERROR: .env is missing. Run CONFIGURE_PROJECT.bat first.
  pause
  exit /b 1
)

set "APP_PORT="
for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=4173; while($p -le 4180){ if(-not (Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue)){ Write-Output $p; exit 0 }; $p++ }; exit 1"`) do set "APP_PORT=%%P"
if not defined APP_PORT (
  echo ERROR: No free port from 4173 to 4180.
  pause
  exit /b 1
)

call "%PROJECT_ROOT%\scripts\windows\service-manager.bat" start "%APP_PORT%"
if errorlevel 1 (
  echo ERROR: Master API failed to start. Check logs\jewelchain-server.log.
  pause
  exit /b 1
)

set "MASTER_BASE_URL=http://127.0.0.1:%APP_PORT%"
call "%PROJECT_ROOT%\scripts\windows\worker-service-manager.bat" start
if errorlevel 1 (
  echo ERROR: Image Worker failed to start. Check logs\image-worker.log.
  pause
  exit /b 1
)

set "APP_URL=http://127.0.0.1:%APP_PORT%/"
set "EDGE_PATH="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "EDGE_PATH=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined EDGE_PATH if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "EDGE_PATH=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if defined EDGE_PATH (start "" "%EDGE_PATH%" --app="%APP_URL%" --start-maximized) else (start "" "%APP_URL%")

echo.
echo JewelChain Studio v1.3.1 started:
echo Master UI/API: %APP_URL%
echo Image Worker: background service
echo Worker log: %PROJECT_ROOT%\logs\image-worker.log
echo.
echo Close this window safely. Use STOP_JEWELCHAIN.bat to stop both processes.
timeout /t 4 >nul
exit /b 0

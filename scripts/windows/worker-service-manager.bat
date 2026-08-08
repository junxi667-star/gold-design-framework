@echo off
setlocal EnableExtensions
for %%I in ("%~dp0..\..") do set "PROJECT_ROOT=%%~fI"

if "%~1"=="" goto :usage
if "%~1"=="start" goto :start
if "%~1"=="stop" goto :stop
if "%~1"=="status" goto :status
goto :usage

:start
set "STATE_FILE=%PROJECT_ROOT%\.jewelchain-worker.json"
set "BINARY=%PROJECT_ROOT%\jewelchain-worker.exe"
set "LOG_DIR=%PROJECT_ROOT%\logs"
set "LOG_FILE=%LOG_DIR%\image-worker.log"
if not exist "%BINARY%" (
  echo ERROR: jewelchain-worker.exe not found. Build with: go build -o jewelchain-worker.exe ./cmd/jewelchain-worker
  exit /b 1
)
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
start "" /B "%BINARY%" > "%LOG_FILE%" 2>&1
echo {"pid":%ERRORLEVEL%,"startedAt":"%DATE% %TIME%","logFile":"%LOG_FILE%"} > "%STATE_FILE%"
echo JewelChain Go Image Worker started.
echo Log: %LOG_FILE%
goto :eof

:stop
set "STATE_FILE=%PROJECT_ROOT%\.jewelchain-worker.json"
if not exist "%STATE_FILE%" (
  echo No worker state file found.
  goto :eof
)
taskkill /F /IM jewelchain-worker.exe >nul 2>&1
del "%STATE_FILE%" >nul 2>&1
echo JewelChain Go Image Worker stopped.
goto :eof

:status
tasklist /FI "IMAGENAME eq jewelchain-worker.exe" 2>nul | find /I "jewelchain-worker.exe" >nul
if %ERRORLEVEL%==0 (
  echo RUNNING
) else (
  echo STOPPED
)
goto :eof

:usage
echo Usage: worker-service-manager.bat start^|stop^|status
exit /b 1

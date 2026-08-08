@echo off
setlocal EnableExtensions
for %%I in ("%~dp0..\..") do set "PROJECT_ROOT=%%~fI"

if "%~1"=="" goto :usage
if "%~1"=="start" goto :start
if "%~1"=="stop" goto :stop
goto :usage

:start
set "PORT=%~2"
if "%PORT%"=="" set "PORT=4173"
set "STATE_FILE=%PROJECT_ROOT%\.gold-demo-server.json"
set "BINARY=%PROJECT_ROOT%\jewelchain-server.exe"
set "LOG_DIR=%PROJECT_ROOT%\logs"
if not exist "%BINARY%" (
  echo ERROR: jewelchain-server.exe not found. Build with: go build -o jewelchain-server.exe ./cmd/jewelchain-server
  exit /b 1
)
if not exist "%PROJECT_ROOT%\.env" (
  echo ERROR: .env is missing. Run CONFIGURE_PROJECT.bat first.
  exit /b 1
)
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
start "" /B "%BINARY%" --port "%PORT%" > "%PROJECT_ROOT%\logs\jewelchain-server.log" 2>&1
echo {"pid":%ERRORLEVEL%,"port":%PORT%} > "%STATE_FILE%"
echo Started JewelChain Go Master on port %PORT%
goto :eof

:stop
set "STATE_FILE=%PROJECT_ROOT%\.gold-demo-server.json"
if not exist "%STATE_FILE%" (
  echo No server state file found.
  goto :eof
)
taskkill /F /IM jewelchain-server.exe >nul 2>&1
del "%STATE_FILE%" >nul 2>&1
echo Stopped.
goto :eof

:usage
echo Usage: service-manager.bat start^|stop [port]
exit /b 1

@echo off
setlocal EnableExtensions
for %%I in ("%~dp0..\..\..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%"
title JewelChain Public Demo

if not exist "%PROJECT_ROOT%\cloudflared.exe" (
  echo ERROR: cloudflared.exe is missing.
  echo Run DOWNLOAD_CLOUDFLARED.bat first.
  pause
  exit /b 1
)
if not exist "%PROJECT_ROOT%\.env" (
  echo ERROR: .env is missing. Run CONFIGURE_PROJECT.bat first.
  pause
  exit /b 1
)
findstr /B /C:"DEMO_ACCESS_CODE=" "%PROJECT_ROOT%\.env" | findstr /V /R "DEMO_ACCESS_CODE=$" >nul
if errorlevel 1 (
  echo WARNING: DEMO_ACCESS_CODE appears empty.
  echo Anyone with the public URL could consume your paid image API.
  choice /M "Continue anyway"
  if errorlevel 2 exit /b 1
)

call "%PROJECT_ROOT%\scripts\windows\lifecycle\start-jewelchain.bat"
if errorlevel 1 exit /b 1
set "APP_PORT=4173"
if exist "%PROJECT_ROOT%\.gold-demo-server.json" (
  for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $s=Get-Content -Raw '%PROJECT_ROOT%\.gold-demo-server.json' | ConvertFrom-Json; Write-Output $s.port } catch { exit 1 }"`) do set "APP_PORT=%%P"
)
echo.
echo ====================================================
echo Cloudflare Quick Tunnel is starting.
echo Keep THIS window open during the public demo.
echo Share the https://...trycloudflare.com URL shown below.
echo Mobile wallet users should open it in MetaMask Browser.
echo ====================================================
echo.
"%PROJECT_ROOT%\cloudflared.exe" tunnel --url "http://127.0.0.1:%APP_PORT%"
echo.
echo Public tunnel stopped.
pause

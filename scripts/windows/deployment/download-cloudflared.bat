@echo off
setlocal
for %%I in ("%~dp0..\..\..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%"
echo Downloading official Cloudflare Tunnel client...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '%PROJECT_ROOT%\cloudflared.exe'"
if errorlevel 1 (
  echo Download failed. Check your network or download cloudflared-windows-amd64.exe manually.
  pause
  exit /b 1
)
echo SUCCESS: cloudflared.exe saved in this folder.
pause

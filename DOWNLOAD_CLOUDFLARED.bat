@echo off
setlocal
cd /d "%~dp0"
echo Downloading official Cloudflare Tunnel client...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '%~dp0cloudflared.exe'"
if errorlevel 1 (
  echo Download failed. Check your network or download cloudflared-windows-amd64.exe manually.
  pause
  exit /b 1
)
echo SUCCESS: cloudflared.exe saved in this folder.
pause

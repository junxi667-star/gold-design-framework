@echo off
setlocal
cd /d "%~dp0"
if not exist "%~dp0runtime\node.exe" exit /b 1
"%~dp0runtime\node.exe" "%~dp0worker-service-manager.js" stop
"%~dp0runtime\node.exe" "%~dp0service-manager.js" stop
pause

@echo off
setlocal
cd /d "%~dp0"
"%~dp0runtime\node.exe" "%~dp0service-manager.js" start 4173
pause

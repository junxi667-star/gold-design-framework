@echo off
setlocal
cd /d "%~dp0"
"%~dp0runtime\node.exe" "%~dp0worker-service-manager.js" stop
pause

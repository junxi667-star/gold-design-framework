@echo off
setlocal
cd /d "%~dp0"
"%~dp0runtime\node.exe" "%~dp0scripts\diagnose.js"
echo.
echo Look for onlineWorkers: 1 or more.
pause

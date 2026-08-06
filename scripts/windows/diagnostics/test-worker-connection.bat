@echo off
setlocal
for %%I in ("%~dp0..\..\..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%"
"%PROJECT_ROOT%\runtime\node.exe" "%PROJECT_ROOT%\scripts\diagnose.js"
echo.
echo Look for onlineWorkers: 1 or more.
pause

@echo off
setlocal
for %%I in ("%~dp0..\..\..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%"
"%PROJECT_ROOT%\runtime\node.exe" "%PROJECT_ROOT%\scripts\windows\worker-service-manager.js" stop
pause

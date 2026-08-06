@echo off
setlocal
for %%I in ("%~dp0..\..\..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%"
if not exist "%PROJECT_ROOT%\runtime\node.exe" exit /b 1
"%PROJECT_ROOT%\runtime\node.exe" "%PROJECT_ROOT%\scripts\windows\worker-service-manager.js" stop
"%PROJECT_ROOT%\runtime\node.exe" "%PROJECT_ROOT%\scripts\windows\service-manager.js" stop
pause

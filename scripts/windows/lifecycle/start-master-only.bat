@echo off
setlocal
for %%I in ("%~dp0..\..\..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%"
"%PROJECT_ROOT%\runtime\node.exe" "%PROJECT_ROOT%\scripts\windows\service-manager.js" start 4173
pause

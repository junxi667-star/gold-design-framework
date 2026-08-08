@echo off
setlocal
for %%I in ("%~dp0..\..\..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%"
call "%PROJECT_ROOT%\scripts\windows\service-manager.bat" start 4173
pause

@echo off
setlocal
call "%~dp0scripts\windows\lifecycle\start-master-only.bat" %*
exit /b %errorlevel%

@echo off
setlocal
call "%~dp0scripts\windows\lifecycle\start-image-worker-only.bat" %*
exit /b %errorlevel%

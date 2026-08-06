@echo off
setlocal
call "%~dp0scripts\windows\lifecycle\run-image-worker.bat" %*
exit /b %errorlevel%

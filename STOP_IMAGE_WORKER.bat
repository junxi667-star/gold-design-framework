@echo off
setlocal
call "%~dp0scripts\windows\lifecycle\stop-image-worker.bat" %*
exit /b %errorlevel%

@echo off
setlocal
call "%~dp0START_IMAGE_WORKER_ONLY.bat" %*
exit /b %errorlevel%

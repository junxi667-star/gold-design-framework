@echo off
setlocal
call "%~dp0RUN_IMAGE_WORKER.bat" %*
exit /b %errorlevel%

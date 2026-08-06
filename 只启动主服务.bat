@echo off
setlocal
call "%~dp0START_MASTER_ONLY.bat" %*
exit /b %errorlevel%

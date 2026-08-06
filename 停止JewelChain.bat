@echo off
setlocal
call "%~dp0STOP_JEWELCHAIN.bat" %*
exit /b %errorlevel%

@echo off
setlocal
call "%~dp0scripts\windows\deployment\download-cloudflared.bat" %*
exit /b %errorlevel%

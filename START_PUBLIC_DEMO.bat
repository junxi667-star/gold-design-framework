@echo off
setlocal
call "%~dp0scripts\windows\deployment\start-public-demo.bat" %*
exit /b %errorlevel%

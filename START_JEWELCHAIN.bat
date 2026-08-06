@echo off
setlocal
call "%~dp0scripts\windows\lifecycle\start-jewelchain.bat" %*
exit /b %errorlevel%

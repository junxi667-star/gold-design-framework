@echo off
setlocal
call "%~dp0scripts\windows\lifecycle\stop-jewelchain.bat" %*
exit /b %errorlevel%

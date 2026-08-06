@echo off
setlocal
call "%~dp0scripts\windows\diagnostics\test-worker-connection.bat" %*
exit /b %errorlevel%

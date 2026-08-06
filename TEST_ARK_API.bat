@echo off
setlocal
call "%~dp0scripts\windows\diagnostics\test-ark-api.bat" %*
exit /b %errorlevel%

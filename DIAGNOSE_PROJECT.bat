@echo off
setlocal
call "%~dp0scripts\windows\diagnostics\diagnose-project.bat" %*
exit /b %errorlevel%

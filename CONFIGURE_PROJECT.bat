@echo off
setlocal
call "%~dp0scripts\windows\configuration\configure-project.bat" %*
exit /b %errorlevel%

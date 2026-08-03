@echo off
setlocal
cd /d "%~dp0"
if not exist "%~dp0runtime\node.exe" (
  echo ERROR: runtime\node.exe is missing.
  pause
  exit /b 1
)
"%~dp0runtime\node.exe" "%~dp0scripts\diagnose.js"
echo.
pause

@echo off
setlocal
for %%I in ("%~dp0..\..\..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%"
if not exist "%PROJECT_ROOT%\runtime\node.exe" (
  echo ERROR: runtime\node.exe is missing.
  pause
  exit /b 1
)
"%PROJECT_ROOT%\runtime\node.exe" "%PROJECT_ROOT%\scripts\diagnose.js"
echo.
pause

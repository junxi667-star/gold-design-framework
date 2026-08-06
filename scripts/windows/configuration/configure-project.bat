@echo off
setlocal
for %%I in ("%~dp0..\..\..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%"
if not exist "%PROJECT_ROOT%\.env" (
  copy /Y "%PROJECT_ROOT%\.env.example" "%PROJECT_ROOT%\.env" >nul
  echo Created .env from .env.example
)
start "" notepad.exe "%PROJECT_ROOT%\.env"
echo Fill ARK_API_KEY first. Optional: Supabase and DEMO_ACCESS_CODE.
pause

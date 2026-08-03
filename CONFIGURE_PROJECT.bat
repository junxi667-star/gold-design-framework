@echo off
setlocal
cd /d "%~dp0"
if not exist ".env" (
  copy /Y ".env.example" ".env" >nul
  echo Created .env from .env.example
)
start "" notepad.exe "%~dp0.env"
echo Fill ARK_API_KEY first. Optional: Supabase and DEMO_ACCESS_CODE.
pause

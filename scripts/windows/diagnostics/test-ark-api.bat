@echo off
setlocal
for %%I in ("%~dp0..\..\..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%"
echo Ark API test is not available in Go backend yet.
echo Configure ARK_API_KEY in .env and check /api/hackathon/config endpoint.
pause

@echo off
setlocal
for %%I in ("%~dp0..\..\..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%"
title JewelChain Image Worker v1.3.0
"%PROJECT_ROOT%\runtime\node.exe" "%PROJECT_ROOT%\worker\image-worker.js"
echo.
pause

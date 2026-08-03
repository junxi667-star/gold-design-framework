@echo off
setlocal
cd /d "%~dp0"
title JewelChain Image Worker v1.2.0
"%~dp0runtime\node.exe" "%~dp0worker\image-worker.js"
echo.
pause

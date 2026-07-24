@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Gold AI Design Demo

if not exist "%~dp0runtime\node.exe" (
  echo ERROR: Portable runtime is missing.
  echo Extract the ZIP completely, then run START_DEMO.bat.
  echo Do not run this file inside the ZIP preview window.
  pause
  exit /b 1
)

if not exist "%~dp0service-manager.js" (
  echo ERROR: The demo package is incomplete. Extract the ZIP again.
  pause
  exit /b 1
)

echo Starting Gold AI Design Demo...
echo.

"%~dp0runtime\node.exe" "%~dp0service-manager.js" start

if errorlevel 1 (
  echo.
  echo Startup failed. Read the message above.
  pause
)

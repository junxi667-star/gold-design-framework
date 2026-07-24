@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Gold AI Design Demo

if not exist "%~dp0runtime\node.exe" (
  echo ERROR: Portable runtime is missing.
  pause
  exit /b 1
)

if not exist "%~dp0service-manager.js" (
  echo ERROR: The demo package is incomplete.
  pause
  exit /b 1
)

"%~dp0runtime\node.exe" "%~dp0service-manager.js" stop

if errorlevel 1 (
  echo.
  echo Stop failed. Read the message above.
  pause
)

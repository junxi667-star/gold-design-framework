@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Gold AI Design Demo V0.6.0

if /i "%~1"=="--syntax-smoke" (
  echo GOLD_STOP_CMD_SMOKE_OK
  exit /b 0
)

if not exist "%~dp0runtime\node.exe" (
  echo ERROR: Portable Node.js runtime is missing.
  pause
  exit /b 1
)

if not exist "%~dp0scripts\stop.ps1" (
  echo ERROR: The V0.6.0 package is incomplete.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop.ps1"

if errorlevel 1 (
  echo.
  echo Stop failed. Read the message above.
  pause
  exit /b 1
)

@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Gold AI Design Demo V0.6.0

if /i "%~1"=="--syntax-smoke" (
  echo GOLD_START_CMD_SMOKE_OK
  exit /b 0
)

if not exist "%~dp0runtime\node.exe" (
  echo ERROR: Portable Node.js runtime is missing.
  echo Please extract the ZIP completely before starting.
  pause
  exit /b 1
)

if not exist "%~dp0scripts\start.ps1" (
  echo ERROR: The V0.6.0 package is incomplete.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1"

if errorlevel 1 (
  echo.
  echo Startup failed. Read the message above.
  pause
  exit /b 1
)

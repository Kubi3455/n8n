@echo off
chcp 65001 >nul
title Viral Video Studio
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js bulunamadi.
  echo   https://nodejs.org adresinden LTS surumunu kurun, sonra bu dosyayi tekrar calistirin.
  echo.
  pause
  exit /b 1
)

node server/index.js
echo.
echo   Uygulama durdu.
pause

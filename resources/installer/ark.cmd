@echo off
if /i "%~1"=="start" if "%~2"=="" (
  start "" "%~dp0..\Ark.exe"
  exit /b 0
)
echo Usage: ark start
exit /b 1

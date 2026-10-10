@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_offline_demo.ps1"
if errorlevel 1 pause
exit /b %errorlevel%

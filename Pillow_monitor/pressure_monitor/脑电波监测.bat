@echo off
cd /d "%~dp0"

rem 检查 8000 端口是否已有服务在跑
netstat -ano | findstr ":8000" | findstr "LISTENING" >nul
if %errorlevel%==0 (
    echo [OK] Service already running. Opening page...
) else (
    echo [..] Starting service on COM3 ...
    start "PressureMonitor" /min cmd /c "python server.py --port COM3"
    timeout /t 3 /nobreak >nul
)

start "" http://127.0.0.1:8000/eeg
exit

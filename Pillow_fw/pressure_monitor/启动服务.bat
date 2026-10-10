@echo off
cd /d "%~dp0"
title DreamGuardian Monitor

set "PY=D:\miniconda3\python.exe"
if not exist "%PY%" (
    echo [ERROR] python not found: %PY%
    pause
    exit /b 1
)

echo [1/3] checking port 8000 ...
netstat -ano | findstr ":8000" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [OK] server already running, open browser now ...
    goto OPEN
)

echo [2/3] starting server on COM3 @ 115200 ...
start /b "" "%PY%" server.py --port COM3 --baud 115200

:OPEN
echo [3/3] waiting 2s then open browser ...
ping 127.0.0.1 -n 3 >nul
powershell -NoProfile -Command "Start-Process 'http://127.0.0.1:8000'"
echo [DONE] close this window to stop the server.
pause

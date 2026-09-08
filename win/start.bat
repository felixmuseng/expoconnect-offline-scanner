@echo off
cd /d "%~dp0"
tasklist /fi "imagename eq caddy.exe" | find /i "caddy.exe" >nul || start "" /min caddy.exe file-server --root dist --listen 127.0.0.1:8000
timeout /t 1 /nobreak >nul
start "" msedge --app=http://localhost:8000 --kiosk-printing || start "" chrome --app=http://localhost:8000 --kiosk-printing

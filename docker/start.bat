@echo off
cd /d "%~dp0"
docker info >nul 2>&1 || (echo Docker Desktop is not running. Start it and try again. & pause & exit /b 1)
rem Pulls the image on first run (needs internet once). Later runs use the cached image offline.
docker compose up -d || (pause & exit /b 1)
set PORT=8000
if exist .env for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do if /i "%%a"=="PORT" set PORT=%%b
timeout /t 2 /nobreak >nul
start "" msedge --app=http://localhost:%PORT% --kiosk-printing || start "" chrome --app=http://localhost:%PORT% --kiosk-printing

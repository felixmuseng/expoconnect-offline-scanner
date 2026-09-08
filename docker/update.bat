@echo off
rem Run while online to fetch the newest app version.
cd /d "%~dp0"
docker compose pull && docker compose up -d
pause

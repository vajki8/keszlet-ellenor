@echo off
cd /d "%~dp0"
echo Dashboard inditasa...
start "" cmd /c "npm run dev"
timeout /t 3 /nobreak >nul
start "" "http://localhost:5173/keszlet-ellenor/"

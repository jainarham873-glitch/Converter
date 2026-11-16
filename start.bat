@echo off
title SoundFlux - MP3 Converter Studio
cd /d "%~dp0"
echo ===================================================
echo     SOUNDFLUX - LINK TO MP3 STUDIO CONVERTER
echo ===================================================
echo.
echo Starting local web server on http://localhost:5000 ...
echo.
timeout /t 2 /nobreak >nul
start "" "http://localhost:5000"
python app.py
pause

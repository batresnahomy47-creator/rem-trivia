@echo off
cd /d "%~dp0"
echo Iniciando el juego de REM...
start "" http://localhost:3000/pantalla
node server.js
pause

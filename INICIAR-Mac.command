#!/bin/bash
cd "$(dirname "$0")"
echo "Iniciando el juego de REM..."
(sleep 2; open http://localhost:3000/pantalla) &
node server.js

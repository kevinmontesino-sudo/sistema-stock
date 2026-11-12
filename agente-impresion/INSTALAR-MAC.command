#!/bin/bash
# Doble click: instala el agente de impresion en esta Mac (se abre en Terminal, no en un editor).
cd "$(dirname "$0")"
bash ./instalar-mac.sh
echo
read -n 1 -s -r -p "Listo. Apretá cualquier tecla para cerrar..."

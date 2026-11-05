#!/bin/bash
# Vuelve a armar los instaladores del kit despues de tocar el agente (agente-impresion/). Se corre en la Mac de Kevin.
set -e
cd "$(dirname "$0")"
../agente-impresion/empaquetar.sh
cp ../agente-impresion/dist/agente-impresion-windows.zip 01_Windows/
cp ../agente-impresion/agente.mjs ../agente-impresion/imprimir-raw.ps1 ../agente-impresion/instalar-mac.sh 02_Mac/
echo "Kit actualizado."

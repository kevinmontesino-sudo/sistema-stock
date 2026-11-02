#!/bin/bash
# Arma dist/agente-impresion-windows.zip: node.exe oficial (verificado con su SHA-256) + el agente + el instalador.
# Se corre en la Mac de desarrollo; el zip resultante se copia a cada PC con Windows (pendrive, Drive, etc.).
set -e
cd "$(dirname "$0")"
VER="v22.23.4"
ZIP="node-$VER-win-x64.zip"
SHA="cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20"
TMP="$(mktemp -d)"
curl -fsSL "https://nodejs.org/dist/$VER/$ZIP" -o "$TMP/$ZIP"
[ "$(shasum -a 256 "$TMP/$ZIP" | cut -d' ' -f1)" = "$SHA" ] || { echo "El SHA-256 de node no coincide. Aborto."; exit 1; }
unzip -q "$TMP/$ZIP" "node-$VER-win-x64/node.exe" -d "$TMP"
PAQ="$TMP/agente-impresion-windows"
mkdir -p "$PAQ" dist
cp "$TMP/node-$VER-win-x64/node.exe" "$PAQ/"
cp agente.mjs imprimir-raw.ps1 "$PAQ/"
# Los .bat con saltos de linea de Windows (CRLF) para que cmd los lea bien.
for f in instalar desinstalar; do sed 's/$/\r/' "windows/$f.bat" > "$PAQ/$f.bat"; done
cp LEEME.txt "$PAQ/"
rm -f dist/agente-impresion-windows.zip
(cd "$TMP" && zip -qr "$OLDPWD/dist/agente-impresion-windows.zip" agente-impresion-windows)
rm -rf "$TMP"
ls -lh dist/agente-impresion-windows.zip

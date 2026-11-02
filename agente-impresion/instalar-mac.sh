#!/bin/bash
# Instala el agente de impresion en esta Mac: queda abierto siempre y arranca solo al iniciar sesion.
# Uso: bash instalar-mac.sh   (el agente se copia FUERA de Documentos porque macOS no deja a launchd leerlo ahi)
set -e
AQUI="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.config/xmenosmas/agente-impresion"
ETIQ="com.xmenosmasprendas.agente-impresion"
PLIST="$HOME/Library/LaunchAgents/$ETIQ.plist"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "Falta Node. Instalalo desde nodejs.org y volve a correr esto."; exit 1; }

mkdir -p "$DEST" "$HOME/Library/LaunchAgents"
cp "$AQUI/agente.mjs" "$AQUI/imprimir-raw.ps1" "$DEST/"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$ETIQ</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DEST/agente.mjs</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DEST/salida.log</string>
  <key>StandardErrorPath</key><string>$DEST/salida.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/$ETIQ" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
sleep 2
echo "Listo. Estado del agente:"
curl -s http://127.0.0.1:9101/ || echo "No responde: mira $DEST/salida.log"

#!/bin/bash
# Deja andando el respaldo automatico de todos los dias (22:30) en esta Mac. Se corre una vez; se puede repetir sin problema.
# Si algun dia cambia la contrasena de la base real, volver a correrlo (copia de nuevo la conexion).
set -eu
cd "$(dirname "$0")/.."
BASE="$HOME/.config/xmenosmas"
mkdir -p "$BASE" && chmod 700 "$BASE"
[ -f .env.prod.local ] || { echo "Falta app/.env.prod.local (la conexion a la base real)."; exit 1; }
cp .env.prod.local "$BASE/prod.env" && chmod 600 "$BASE/prod.env"
cp scripts/respaldo-completo.sh "$BASE/respaldo-completo.sh" && chmod 700 "$BASE/respaldo-completo.sh"
PLIST="$HOME/Library/LaunchAgents/com.xmenosmasprendas.respaldo-stock.plist"
cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.xmenosmasprendas.respaldo-stock</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$BASE/respaldo-completo.sh</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>22</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>$BASE/ultima-salida.txt</string>
  <key>StandardErrorPath</key><string>$BASE/ultima-salida.txt</string>
</dict></plist>
PLIST_EOF
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Respaldo automatico instalado: todos los dias a las 22:30 (si la Mac esta dormida, corre al despertar)."
echo "Los respaldos quedan en $HOME/respaldos-stock-completos"

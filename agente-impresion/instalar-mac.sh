#!/bin/bash
# Instala el agente de impresion en esta Mac: queda abierto siempre y arranca solo al iniciar sesion.
# Uso: bash instalar-mac.sh   (no hace falta tener Node: baja el oficial, verificado, y lo guarda junto al agente)
# El agente se copia FUERA de Documentos porque macOS no deja a launchd leerlo ahi.
set -e
AQUI="$(cd "$(dirname "$0")" && pwd)"
DEST="${AGENTE_DEST:-$HOME/.config/xmenosmas/agente-impresion}"
ETIQ="com.xmenosmasprendas.agente-impresion"
PLIST="$HOME/Library/LaunchAgents/$ETIQ.plist"
VER="v22.23.4"

mkdir -p "$DEST"

# Node propio del agente (asi no depende de lo que tenga instalado esa Mac).
if [ ! -x "$DEST/node" ]; then
  case "$(uname -m)" in
    arm64)  ARQ=arm64; SHA=c9e1dbc748b33ed2d14f42445191ecaf14c56259c7a9a26d0042c49ec2b66428 ;;
    x86_64) ARQ=x64;   SHA=efcc2b0db6f94bf53eddb038fe2b370277a042bd29e4f19b8f8e23598795b819 ;;
    *) echo "Esta Mac no es compatible (arquitectura $(uname -m))."; exit 1 ;;
  esac
  echo "Bajando Node oficial ($ARQ)..."
  TMP="$(mktemp -d)"
  curl -fsSL "https://nodejs.org/dist/$VER/node-$VER-darwin-$ARQ.tar.gz" -o "$TMP/node.tar.gz" || { echo "No se pudo bajar Node. Revisa la conexion a internet."; exit 1; }
  [ "$(shasum -a 256 "$TMP/node.tar.gz" | cut -d' ' -f1)" = "$SHA" ] || { echo "El archivo de Node bajado no coincide con su firma. Aborto."; exit 1; }
  tar -xzf "$TMP/node.tar.gz" -C "$TMP" "node-$VER-darwin-$ARQ/bin/node"
  cp "$TMP/node-$VER-darwin-$ARQ/bin/node" "$DEST/node"
  chmod +x "$DEST/node"
  rm -rf "$TMP"
fi
[ -z "$AGENTE_SOLO_NODE" ] || { echo "Node listo en $DEST/node"; exit 0; }

mkdir -p "$HOME/Library/LaunchAgents"
cp "$AQUI/agente.mjs" "$AQUI/imprimir-raw.ps1" "$DEST/"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$ETIQ</string>
  <key>ProgramArguments</key><array><string>$DEST/node</string><string>$DEST/agente.mjs</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DEST/salida.log</string>
  <key>StandardErrorPath</key><string>$DEST/salida.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/$ETIQ" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
# La primera vez Mac revisa el programa y puede tardar: se espera hasta 30 segundos a que conteste.
ESTADO=""
for i in $(seq 1 30); do
  ESTADO="$(curl -s http://127.0.0.1:9101/ || true)"
  [ -n "$ESTADO" ] && break
  sleep 1
done
echo
if [ -z "$ESTADO" ]; then
  echo "X El agente no responde. Datos para avisar:"
  echo "  Mac: $(sw_vers -productVersion) ($(uname -m))"
  echo "  Node: $("$DEST/node" -v 2>&1 | head -2)"
  echo "  Registro ($DEST/salida.log):"
  tail -15 "$DEST/salida.log" 2>/dev/null | sed 's/^/    /'
  exit 1
fi
echo "$ESTADO"
echo
echo "$ESTADO" | grep -qiE "TM-T20|ticket" && echo "OK  Impresora de tickets (Epson) encontrada" || echo "--  No aparece la impresora de tickets: agregala en Ajustes > Impresoras y escaneres (nombre con TM-T20 o 'ticket')"
echo "$ESTADO" | grep -qi "410" && echo "OK  Impresora de etiquetas (Xprinter) encontrada" || echo "--  No aparece la impresora de etiquetas: agregala (nombre con 410). Si esta PC no imprime etiquetas, ignoralo."

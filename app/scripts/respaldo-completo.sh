#!/bin/bash
# Respaldo COMPLETO de la base real (formato pg_dump, restaurable con pg_restore), pasando por el tunel SSH.
# A diferencia de `npm run respaldo` (JSON sin claves), este incluye TODO: sirve para recuperar el sistema entero.
# Por eso la carpeta es privada (solo tu usuario) y conviene tener FileVault prendido en la Mac.
# Uso:  bash scripts/respaldo-completo.sh        (el de todos los dias lo corre solo launchd a las 22:30)
# Instalacion (una vez):  bash scripts/respaldo-instalar.sh
# Ojo: macOS no deja que las tareas automaticas lean la carpeta Documentos, por eso el script, la conexion y los respaldos
# viven fuera de ella (~/.config/xmenosmas y ~/respaldos-stock-completos).
set -u
PG=/opt/homebrew/opt/postgresql@17/bin
CONEXION="${CONEXION_PROD:-$HOME/.config/xmenosmas/prod.env}"
DESTINO="${RESPALDOS_DIR:-$HOME/respaldos-stock-completos}"
LOG="$DESTINO/respaldo.log"
mkdir -p "$DESTINO" && chmod 700 "$DESTINO"

aviso() { osascript -e "display notification \"$1\" with title \"Respaldo del sistema de stock\"" >/dev/null 2>&1; }
falla() { echo "$(date '+%F %T') ERROR: $1" >> "$LOG"; echo "ERROR: $1" >&2; aviso "No se pudo hacer el respaldo: $1"; exit 1; }

[ -f "$CONEXION" ] || falla "falta $CONEXION (la conexion a la base real; la crea respaldo-instalar.sh)"
URL=$(grep '^DATABASE_URL=' "$CONEXION" | head -1 | cut -d= -f2- | tr -d '"')
[ -n "$URL" ] || falla "no encuentro DATABASE_URL en $CONEXION"

ARCHIVO="$DESTINO/stock-$(date +%Y-%m-%d_%H%M).dump"
"$PG/pg_dump" --format=custom --no-owner --dbname="$URL" --file="$ARCHIVO.parcial" 2>>"$LOG" || { rm -f "$ARCHIVO.parcial"; falla "pg_dump no pudo conectarse (esta prendido el tunel?)"; }
# Se verifica que el archivo se pueda leer antes de darlo por bueno.
TABLAS=$("$PG/pg_restore" --list "$ARCHIVO.parcial" 2>/dev/null | grep -c " TABLE DATA ")
[ "${TABLAS:-0}" -ge 10 ] || { rm -f "$ARCHIVO.parcial"; falla "el respaldo salio incompleto ($TABLAS tablas)"; }
mv "$ARCHIVO.parcial" "$ARCHIVO" && chmod 600 "$ARCHIVO"
echo "$(date '+%F %T') OK $(basename "$ARCHIVO") ($(du -h "$ARCHIVO" | cut -f1), $TABLAS tablas)" >> "$LOG"

# Se guardan los de los ultimos 30 dias, pero nunca menos de 10 archivos.
ls -1t "$DESTINO"/stock-*.dump 2>/dev/null | tail -n +11 | while read -r viejo; do
  [ -n "$(find "$viejo" -mtime +30 2>/dev/null)" ] && rm -f "$viejo"
done
echo "Respaldo listo: $ARCHIVO"

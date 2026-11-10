#!/bin/bash
# Cambio de estructura de precios ("lista = tarjeta") SOLO sobre la COPIA DE PRUEBAS (sistema_stock_staging en 127.0.0.1:5432).
# Corre db/cambios/precios-lista-tarjeta.sql. Por defecto es un ENSAYO (ROLLBACK): imprime la tabla antes/despues y no guarda nada.
#
# Uso:  npm run staging:precios                       ensayo (no guarda)
#       npm run staging:precios -- --aplicar          guarda (COMMIT)
#       npm run staging:precios -- --revertir         vuelve a los precios, porcentajes, notas y promos de antes (con --forzar si hubo ventas despues)
# Parametros (los de la estructura recomendada son los valores por defecto):
#       --redondeo=fin900|centena|exacto   --factor=1.2   --tarjeta=0   --transferencia=-10   --efectivo=-30   --sufijo=AAAAMM
# Nunca toca la base real ni la de desarrollo: el destino esta fijo y se valida contra .env.staging.local.
set -euo pipefail

APP="$(cd "$(dirname "$0")/.." && pwd)"
SQL="$(cd "$APP/.." && pwd)/db/cambios/precios-lista-tarjeta.sql"
PG=/opt/homebrew/opt/postgresql@17/bin
ENV_STAGING="$APP/.env.staging.local"
# Destino FIJO (igual que staging-refrescar.sh).
HOST=127.0.0.1; PUERTO=5432; BASE=sistema_stock_staging; USUARIO=stock_app

error() { echo "ERROR: $*" >&2; exit 1; }

[ -f "$SQL" ] || error "no encuentro $SQL"
[ -f "$ENV_STAGING" ] || error "falta $ENV_STAGING (ver PRUEBAS_STAGING.md)"
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' "$ENV_STAGING" | cut -d= -f2-)"
[[ "$DATABASE_URL" =~ ^postgres(ql)?://[^@/]+@127\.0\.0\.1:5432/sistema_stock_staging$ ]] \
  || error "me niego: DATABASE_URL de $ENV_STAGING tiene que ser la copia local 127.0.0.1:5432/sistema_stock_staging"
"$PG/pg_isready" -q -h "$HOST" -p "$PUERTO" || error "el Postgres local (127.0.0.1:5432) no responde. Prendelo con: brew services start postgresql@17"

MODO=ensayo; FORZAR=0; VARS=()
for a in "$@"; do
  case "$a" in
    --aplicar) MODO=aplicar;;
    --revertir) MODO=revertir;;
    --forzar) FORZAR=1;;
    --redondeo=*) VARS+=(-v "redondeo=${a#*=}");;
    --factor=*) VARS+=(-v "factor=${a#*=}");;
    --tarjeta=*) VARS+=(-v "pct_tarjeta=${a#*=}");;
    --transferencia=*) VARS+=(-v "pct_transferencia=${a#*=}");;
    --efectivo=*) VARS+=(-v "pct_efectivo=${a#*=}");;
    --sufijo=*) VARS+=(-v "sufijo=${a#*=}");;
    *) error "opcion desconocida: $a";;
  esac
done

# Control extra: la conexion tiene que quedar en la copia de pruebas.
DONDE=$("$PG/psql" -X -q -h "$HOST" -p "$PUERTO" -U "$USUARIO" -d "$BASE" -Atc "select current_database() || ':' || current_setting('port')")
[ "$DONDE" = "sistema_stock_staging:5432" ] || error "me niego: la conexion quedo en $DONDE"

echo "== Estructura de precios en la COPIA DE PRUEBAS ($BASE) - modo: $MODO"
exec "$PG/psql" -X -q -h "$HOST" -p "$PUERTO" -U "$USUARIO" -d "$BASE" -v ON_ERROR_STOP=1 \
  -v "modo=$MODO" -v "forzar=$FORZAR" ${VARS[@]+"${VARS[@]}"} -f "$SQL"

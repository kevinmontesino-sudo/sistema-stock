#!/bin/bash
# COPIA DE PRUEBAS (staging): borra y vuelve a crear la base local sistema_stock_staging desde el ULTIMO respaldo completo
# de produccion (~/respaldos-stock-completos/stock-AAAA-MM-DD_HHMM.dump) y le aplica las migraciones de ./db que se pueden
# repetir. Nunca se conecta a la base real: la fuente es siempre un archivo .dump de esta Mac.
#
# Uso:  npm run staging:refrescar                 (el ultimo respaldo)
#       npm run staging:refrescar -- otro.dump     (uno elegido)
# Si el sistema de pruebas (npm run staging) estaba prendido, se corta su conexion: volver a arrancarlo despues.
set -euo pipefail

PG=/opt/homebrew/opt/postgresql@17/bin
# Destino FIJO. No se toma de ninguna variable ni archivo: asi es imposible que apunte a la base real o a la de desarrollo.
HOST=127.0.0.1
PUERTO=5432
BASE=sistema_stock_staging
DUENO=stock_app
RESPALDOS="$HOME/respaldos-stock-completos"
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
DB_DIR="$RAIZ/db"

# Migraciones que NO se repiten: crean el esquema desde cero, borran columnas o crean usuarios de la base.
#   001 esquema inicial, 002 duenos, 003 columnas sin "if not exists", 010 usuario stock_web (clave de ejemplo), 011 borra la columna codigo.
# Todas las demas (004-009, 012 en adelante, y las nuevas que se agreguen) estan escritas para poder correrse de nuevo.
NO_REPETIR=" 001 002 003 010 011 "

error() { echo "ERROR: $*" >&2; exit 1; }

# ---- Guardas ----
[ "$HOST" = "127.0.0.1" ] && [ "$PUERTO" = "5432" ] && [ "$BASE" = "sistema_stock_staging" ] \
  || error "me niego: el destino tiene que ser 127.0.0.1:5432/sistema_stock_staging"
[ -x "$PG/pg_restore" ] || error "no encuentro Postgres 17 en $PG"
"$PG/pg_isready" -q -h "$HOST" -p "$PUERTO" || error "el Postgres local (127.0.0.1:5432) no responde. Prendelo con: brew services start postgresql@17"

psql_su() { "$PG/psql" -X -q -v ON_ERROR_STOP=1 -h "$HOST" -p "$PUERTO" "$@"; }
psql_st() { "$PG/psql" -X -q -v ON_ERROR_STOP=1 -h "$HOST" -p "$PUERTO" -U "$DUENO" -d "$BASE" "$@"; }

# ---- Respaldo a usar ----
if [ $# -ge 1 ] && [ -n "$1" ]; then
  DUMP="$1"
else
  DUMP="$(ls -1t "$RESPALDOS"/stock-*.dump 2>/dev/null | head -1 || true)"
  [ -n "$DUMP" ] || error "no hay respaldos en $RESPALDOS (se hacen solos todos los dias a las 22:30)"
fi
[ -f "$DUMP" ] || error "no existe el archivo $DUMP"
case "$DUMP" in *.parcial) error "ese respaldo esta a medio hacer ($DUMP)";; esac
TABLAS=$("$PG/pg_restore" --list "$DUMP" 2>/dev/null | grep -c " TABLE DATA " || true)
[ "${TABLAS:-0}" -ge 10 ] || error "el respaldo $DUMP no se puede leer o esta incompleto ($TABLAS tablas)"
FECHA_DUMP=$("$PG/pg_restore" --list "$DUMP" | sed -n 's/^;[[:space:]]*Archive created at //p' | head -1)

echo "== Copia de pruebas: $BASE en $HOST:$PUERTO"
echo "   Respaldo: $(basename "$DUMP")  (hecho el $FECHA_DUMP, $TABLAS tablas)"

# ---- Borrar y recrear ----
echo "-> Borrando la copia anterior (si el sistema de pruebas estaba prendido, se corta su conexion)..."
"$PG/dropdb" -h "$HOST" -p "$PUERTO" --if-exists --force "$BASE"
"$PG/createdb" -h "$HOST" -p "$PUERTO" -O "$DUENO" "$BASE"

# Control extra: la base recien creada es la de pruebas, en el Postgres local.
DONDE=$(psql_su -d "$BASE" -Atc "select current_database() || '@' || coalesce(inet_server_addr()::text, 'socket') || ':' || current_setting('port')")
case "$DONDE" in "sistema_stock_staging@127.0.0.1"*":5432") ;; *) error "me niego: la conexion quedo en $DONDE";; esac

echo "-> Restaurando el respaldo..."
"$PG/pg_restore" -h "$HOST" -p "$PUERTO" -d "$BASE" --no-owner --role="$DUENO" --single-transaction --exit-on-error "$DUMP" \
  || error "no se pudo restaurar $DUMP (la copia de pruebas quedo vacia; corre de nuevo el comando)"

# ---- Migraciones ----
echo "-> Aplicando migraciones (las que se pueden repetir)..."
APLICADAS=""
ERR=$(mktemp -t staging-migracion)
trap 'rm -f "$ERR"' EXIT
for f in "$DB_DIR"/[0-9][0-9][0-9]_*.sql; do
  nombre=$(basename "$f")
  num=${nombre%%_*}
  case "$NO_REPETIR" in *" $num "*) continue;; esac
  if ! psql_st --single-transaction -f "$f" >/dev/null 2>"$ERR"; then
    cat "$ERR" >&2
    error "fallo la migracion $nombre sobre la copia de pruebas. Arreglala (tiene que poder correrse de nuevo) y refresca otra vez."
  fi
  APLICADAS="$APLICADAS $num"
done
echo "   Aplicadas:$APLICADAS"

# ---- Resumen ----
echo
echo "== Listo. Resumen de la copia de pruebas:"
psql_st -P footer=off -c "
select 'Respaldo del'                     as dato, '$FECHA_DUMP' as valor
union all select 'Prendas (activas)',      count(*)::text from productos where activo
union all select 'Unidades en stock',      coalesce(sum(cantidad), 0)::text from stock
union all select 'Ventas',                 count(*)::text from ventas
union all select 'Ultima venta',           coalesce(to_char(max(creado_en) at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD HH24:MI'), '-') from ventas
union all select 'Notas de credito',       count(*)::text from notas_credito
union all select 'Promos activas',         count(*)::text from promos where activa and hasta >= (now() at time zone 'America/Argentina/Buenos_Aires')::date
union all select 'Usuarios (activos)',     count(*)::text from usuarios where activo
union all select 'Datos de prueba \"ZZ\"', count(*)::text from productos where nombre ilike 'zz%'
"
echo "Siguiente paso: npm run staging  (arranca el sistema de pruebas en http://localhost:3000)"

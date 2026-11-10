#!/bin/bash
# Arranca la COPIA DE PRUEBAS (staging): el mismo codigo compilado en modo produccion (next build + next start), pero contra
# la base local sistema_stock_staging (ver staging-refrescar.sh). Arriba de cada pantalla aparece "COPIA DE PRUEBAS".
#
# Uso:  npm run staging                     (compila y arranca en http://localhost:3000)
#       npm run staging -- --sin-compilar   (arranca el ultimo build de pruebas, sin volver a compilar)
#       PUERTO=3100 npm run staging         (otro puerto; ojo: el agente de impresion solo acepta el 3000)
# Para pararlo: Ctrl+C. No correrlo al mismo tiempo que `npm run dev` (los dos usan el puerto 3000).
set -euo pipefail

APP="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP"
PG=/opt/homebrew/opt/postgresql@17/bin
ENV_STAGING="$APP/.env.staging.local"
ENV_PROD="$APP/.env.prod.local"
PUERTO="${PUERTO:-3000}"
COMPILAR=1
[ "${1:-}" = "--sin-compilar" ] && COMPILAR=0

error() { echo "ERROR: $*" >&2; exit 1; }

# ---- Configuracion de pruebas (nunca la de produccion) ----
[ -f "$ENV_STAGING" ] || error "falta $ENV_STAGING (ver PRUEBAS_STAGING.md)"
set -a
# shellcheck disable=SC1090
. "$ENV_STAGING"
set +a
# Guarda: solo la base de pruebas local. Cualquier otra cosa (la real por el tunel 15432, la de desarrollo) se rechaza.
[[ "${DATABASE_URL:-}" =~ ^postgres(ql)?://[^@/]+@127\.0\.0\.1:5432/sistema_stock_staging$ ]] \
  || error "me niego: DATABASE_URL de $ENV_STAGING tiene que ser la copia local 127.0.0.1:5432/sistema_stock_staging"
[ "${NEXT_PUBLIC_ENTORNO:-}" = "pruebas" ] || error "falta NEXT_PUBLIC_ENTORNO=pruebas en $ENV_STAGING (es el cartel de COPIA DE PRUEBAS)"
"$PG/psql" -X -q -d "$DATABASE_URL" -Atc "select 1 from productos limit 1" >/dev/null 2>&1 \
  || error "la copia de pruebas no existe o esta vacia. Correr antes: npm run staging:refrescar"

# ---- APP_KEY de produccion (para que la doble verificacion de los admins funcione igual) ----
# Se lee SOLO la linea APP_KEY de .env.prod.local, en el momento, y nunca se muestra. El DATABASE_URL real no se toca.
if [ -f "$ENV_PROD" ] && grep -q '^APP_KEY=' "$ENV_PROD"; then
  APP_KEY="$(grep -m1 '^APP_KEY=' "$ENV_PROD" | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//')"
  export APP_KEY
  echo "APP_KEY: tomada de .env.prod.local (no se muestra). Los admins entran con su codigo de siempre."
else
  echo "AVISO: no hay APP_KEY de produccion (.env.prod.local). Los admins con doble verificacion NO van a poder entrar;"
  echo "       los usuarios de los locales si. Ver PRUEBAS_STAGING.md."
fi

# Se fijan todas las variables: asi nada de .env.local (desarrollo) se cuela en la copia de pruebas.
export DATABASE_URL NEXT_PUBLIC_ENTORNO TRUST_PROXY_HOPS="${TRUST_PROXY_HOPS:-0}" REQUERIR_2FA="${REQUERIR_2FA:-}"
export APP_KEY="${APP_KEY:-}"
# El build de pruebas va en otra carpeta: no pisa el de desarrollo (.next/dev) ni un build normal (.next).
export NEXT_DIST_DIR=".next/staging"

if lsof -nP -iTCP:"$PUERTO" -sTCP:LISTEN >/dev/null 2>&1; then
  error "el puerto $PUERTO esta ocupado (seguro esta prendido 'npm run dev'). Paralo con Ctrl+C en su ventana y volve a probar."
fi

if [ "$COMPILAR" = 1 ]; then
  echo "-> Compilando en modo produccion (tarda 1 o 2 minutos)..."
  # next build puede reescribir tsconfig.json y next-env.d.ts por la carpeta distinta: se guardan y se dejan como estaban.
  RESGUARDO="$(mktemp -d -t staging-build)"
  cp tsconfig.json "$RESGUARDO/"; [ -f next-env.d.ts ] && cp next-env.d.ts "$RESGUARDO/"
  restaurar() { cp "$RESGUARDO/tsconfig.json" tsconfig.json; [ -f "$RESGUARDO/next-env.d.ts" ] && cp "$RESGUARDO/next-env.d.ts" next-env.d.ts; rm -rf "$RESGUARDO"; }
  trap restaurar EXIT
  NODE_ENV=production npx next build || error "no compilo (el mismo error saldria en produccion)"
  restaurar; trap - EXIT
fi
[ -f ".next/staging/BUILD_ID" ] || error "no hay build de pruebas: correr sin --sin-compilar"

echo
echo "=============================================================="
echo "  COPIA DE PRUEBAS en http://localhost:$PUERTO  (Ctrl+C para parar)"
echo "  Base: sistema_stock_staging (copia local). NO es el sistema real."
echo "=============================================================="
exec npx next start -p "$PUERTO" -H 127.0.0.1

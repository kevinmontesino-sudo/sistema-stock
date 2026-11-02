#!/bin/bash
# Respaldo diario de la base sistema_stock DENTRO del servidor (VPS). Se instala una sola vez, como root:
#     bash vps-respaldo.sh --instalar
# Despues corre solo todos los dias a las 02:30 y guarda los ultimos 14. Los archivos quedan en /root/backups/stock.
# Es la copia "de adentro". La copia "de afuera" la baja la Mac del deposito todas las noches (respaldo-completo.sh).
set -u
DESTINO=/root/backups/stock
mkdir -p "$DESTINO" && chmod 700 "$DESTINO"

if [ "${1:-}" = "--instalar" ]; then
  cp "$0" /usr/local/sbin/respaldo-stock.sh && chmod 700 /usr/local/sbin/respaldo-stock.sh
  ( crontab -l 2>/dev/null | grep -v respaldo-stock.sh; echo "30 2 * * * /usr/local/sbin/respaldo-stock.sh >> /var/log/respaldo-stock.log 2>&1" ) | crontab -
  echo "Instalado: corre todos los dias a las 02:30. Probando ahora..."
fi

CONT=$(docker ps --filter "name=evolution_postgres" --format '{{.ID}}' | head -1)
[ -n "$CONT" ] || { echo "$(date '+%F %T') ERROR: no encuentro el contenedor evolution_postgres"; exit 1; }
ARCHIVO="$DESTINO/stock-$(date +%F_%H%M).dump"
docker exec "$CONT" sh -c 'pg_dump -U "$POSTGRES_USER" -Fc sistema_stock' > "$ARCHIVO.parcial" || { rm -f "$ARCHIVO.parcial"; echo "$(date '+%F %T') ERROR: fallo pg_dump"; exit 1; }
TABLAS=$(docker exec -i "$CONT" pg_restore --list < "$ARCHIVO.parcial" 2>/dev/null | grep -c " TABLE DATA ")
[ "${TABLAS:-0}" -ge 10 ] || { rm -f "$ARCHIVO.parcial"; echo "$(date '+%F %T') ERROR: respaldo incompleto ($TABLAS tablas)"; exit 1; }
mv "$ARCHIVO.parcial" "$ARCHIVO" && chmod 600 "$ARCHIVO"
find "$DESTINO" -name 'stock-*.dump' -mtime +14 -delete
echo "$(date '+%F %T') OK $(basename "$ARCHIVO") ($(du -h "$ARCHIVO" | cut -f1), $TABLAS tablas)"

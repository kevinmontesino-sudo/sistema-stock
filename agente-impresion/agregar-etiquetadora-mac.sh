#!/bin/bash
# Da de alta en esta Mac una etiquetadora USB nueva (ej. Unnion LP4206D) y manda las 3 etiquetas de prueba (TSPL / ZPL / EPL).
# Uso: conectarla por USB, encenderla y correr:  bash agregar-etiquetadora-mac.sh
# Si hay varias USB nuevas, se puede pasar parte del nombre:  bash agregar-etiquetadora-mac.sh 4206
FILTRO="${1:-}"
URI=$(lpinfo -v 2>/dev/null | awk '/usb:\/\//{print $2}' | grep -iv "EPSON\|Xprinter\|HP" | grep -i "$FILTRO" | head -1)
[ -n "$URI" ] || { echo "No veo ninguna impresora USB nueva. Revisá el cable y que esté encendida."; lpinfo -v | grep usb; exit 1; }
NOMBRE="Etiquetas_$(echo "$URI" | sed 's#usb://##; s#[?].*##; s#[^A-Za-z0-9]#_#g')"
echo "Impresora: $URI -> cola $NOMBRE"
lpadmin -p "$NOMBRE" -E -v "$URI" -m raw 2>/dev/null || lpadmin -p "$NOMBRE" -E -v "$URI" -m drv:///sample.drv/generic.ppd || { echo "No pude crear la cola."; exit 1; }
curl -s "http://127.0.0.1:9101/probar?impresora=$NOMBRE"

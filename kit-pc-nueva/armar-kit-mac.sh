#!/bin/bash
# Arma Kit_Mac_XMenosMas.zip (para subir a Drive). Se corre en la Mac de Kevin; no hace falta internet.
set -e
cd "$(dirname "$0")"
NOMBRE="Kit Mac - X Menos Mas Prendas"
TMP="$(mktemp -d)"
K="$TMP/$NOMBRE"
mkdir -p "$K/programa"
cp ../agente-impresion/agente.mjs ../agente-impresion/imprimir-raw.ps1 ../agente-impresion/instalar-mac.sh "$K/programa/"
mkdir -p "$K/drivers"
cp mac/drivers/* "$K/drivers/"
cp mac/LEEME_PRIMERO.txt mac/Guia_impresoras_Mac.txt mac/Si_algo_falla.txt mac/Checklist_por_Mac.txt "$K/"
cat > "$K/INSTALAR.command" <<'CMD'
#!/bin/bash
cd "$(dirname "$0")"
bash ./programa/instalar-mac.sh
echo
read -n 1 -s -r -p "Listo. Apreta cualquier tecla para cerrar..."
CMD
chmod +x "$K/INSTALAR.command" "$K/programa/instalar-mac.sh"
rm -f Kit_Mac_XMenosMas.zip
(cd "$TMP" && zip -qr "$OLDPWD/Kit_Mac_XMenosMas.zip" "$NOMBRE")
rm -rf "$TMP"
ls -lh Kit_Mac_XMenosMas.zip

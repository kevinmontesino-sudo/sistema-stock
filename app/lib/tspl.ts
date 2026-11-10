import JsBarcode from "jsbarcode";
import { empresa } from "./empresa.config";
import { textoPrecioEtiqueta } from "./util";
import type { DatosEtiqueta } from "@/components/Etiqueta";

// La impresora es de 203 dpi: 8 puntos por milimetro. Una etiqueta de 50x30 mm son 400x240 puntos.
const PUNTOS_MM = 8;
const ANCHO_FUENTE: Record<string, number> = { "2": 12, "3": 16, "4": 24 };

const soloAscii = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "").replace(/"/g, "'").trim();
const pesos = (n: number) => "$" + n.toLocaleString("es-AR");

function modulos(texto: string) {
  const o: { encodings?: { data: string }[] } = {};
  JsBarcode(o, texto, { format: "CODE128", displayValue: false });
  return (o.encodings ?? []).reduce((s, e) => s + e.data.length, 0);
}

// Parte el nombre en dos lineas por palabras: la primera con hasta `max1` letras (despues del SKU), la segunda recortada a `max2`.
function partir(nombre: string, max1: number, max2: number) {
  const palabras = nombre.split(/\s+/).filter(Boolean);
  let primera = "";
  let i = 0;
  for (; i < palabras.length; i++) {
    const prueba = primera ? `${primera} ${palabras[i]}` : palabras[i];
    if (prueba.length > max1) break;
    primera = prueba;
  }
  const resto = palabras.slice(i).join(" ").slice(0, max2);
  return primera ? [primera, resto] : [nombre.slice(0, max2)];
}

// Arma el trabajo de impresion de una etiqueta en TSPL. El codigo de barras lo dibuja la propia impresora.
export function etiquetaTspl(e: DatosEtiqueta, copias: number) {
  const ancho = Math.round(empresa.etiquetaMm.ancho * PUNTOS_MM);
  const alto = Math.round(empresa.etiquetaMm.alto * PUNTOS_MM);
  const margen = 16;
  const sku = soloAscii(e.sku);
  const barraX = Math.max(0, Math.floor((ancho - modulos(sku) * 2) / 2));
  const L: string[] = [
    `SIZE ${empresa.etiquetaMm.ancho} mm,${empresa.etiquetaMm.alto} mm`,
    `GAP ${empresa.tspl.separacionMm} mm,0 mm`,
    `DIRECTION ${empresa.tspl.direccion},0`,
    "REFERENCE 0,0",
    "OFFSET 0 mm",
    `DENSITY ${empresa.servidor.oscuridad}`,
    "SET TEAR ON",
    "SET PEEL OFF",
    "SET CUTTER OFF",
    "CLS",
    // La XP-410B no siempre vacia la memoria con CLS: lo que quedaba de la etiqueta anterior salia encimado. Igual que su
    // driver, se pisa toda la etiqueta con una imagen en blanco (modo 0 = reemplaza; bit 1 = blanco) antes de dibujar.
    `BITMAP 0,0,${ancho / 8},${alto},0,${"\xFF".repeat((ancho / 8) * alto)}`,
  ];
  if (e.marco) L.push(`BOX 0,0,${ancho - 1},${alto - 1},2`);
  // Nombre largo: se parte en dos lineas (como en la etiqueta en PDF) y las barras bajan un poco para que entre todo.
  const nombre = soloAscii(e.nombre);
  const maxLinea = Math.floor((ancho - 2 * margen) / ANCHO_FUENTE["2"]);
  const primera = `${sku}  ${nombre}`;
  const lineas = primera.length <= maxLinea ? [primera] : partir(nombre, maxLinea - sku.length - 2, maxLinea);
  const doble = lineas.length > 1;
  const altoBarras = doble ? 64 : 88;
  L.push(`BARCODE ${barraX},${doble ? 10 : 14},"128",${altoBarras},0,0,2,2,"${sku}"`);
  const y = doble ? 82 : 110;
  if (doble) L.push(`TEXT ${margen},${y},"2",0,1,1,"${sku}  ${lineas[0]}"`, `TEXT ${margen},${y + 22},"2",0,1,1,"${lineas[1]}"`);
  else L.push(`TEXT ${margen},${y},"2",0,1,1,"${lineas[0]}"`);
  // Precios (50x30 mm = 400x240 puntos). Arriba la LISTA en letra chica con las cuotas ("Lista $36.900  3x$12.300"), debajo los medios
  // con descuento en letra mediana y el ultimo (efectivo) destacado: etiqueta en fuente 3 y el precio en fuente 4 (24x32 puntos).
  // Alturas de fuente: 2 = 20, 3 = 24, 4 = 32. Con el nombre en una linea los precios empiezan en 136 y terminan en 222; con dos lineas
  // empiezan en 130 y terminan en 212 (la etiqueta mide 240). Como mucho entran 3 lineas.
  const libre = ancho - 2 * margen;
  const tope = doble ? 130 : 136;
  const lineasPrecio = e.precios.slice(0, 3);
  let y2 = tope;
  for (const p of lineasPrecio) {
    if (p.lista) {
      // Fuente 2 (12 puntos por caracter): "Lista $126.900  3x$42.300" son 26 caracteres = 312 de 368 disponibles.
      L.push(`TEXT ${margen},${y2},"2",0,1,1,"${soloAscii(textoPrecioEtiqueta(p))}"`);
      y2 += 24;
      continue;
    }
    const nombreP = soloAscii(p.nombre);
    const valorP = pesos(p.valor);
    const hueco = 8; // espacio entre la etiqueta y el precio
    if (p.destacado && (nombreP.length * ANCHO_FUENTE["3"] + hueco + valorP.length * ANCHO_FUENTE["4"]) <= libre) {
      // La etiqueta chica queda alineada con la base del precio grande (32 - 24 = 8 puntos mas abajo).
      L.push(`TEXT ${margen},${y2 + 8},"3",0,1,1,"${nombreP}"`);
      L.push(`TEXT ${margen + nombreP.length * ANCHO_FUENTE["3"] + hueco},${y2},"4",0,1,1,"${valorP}"`);
      y2 += 36;
    } else {
      const t = soloAscii(`${p.nombre} ${valorP}`);
      // Si en fuente 3 no entra (nombre de medio muy largo), baja a la 2.
      const fuente = t.length * ANCHO_FUENTE["3"] <= libre ? "3" : "2";
      L.push(`TEXT ${margen},${y2},"${fuente}",0,1,1,"${t}"`);
      y2 += 28;
    }
  }
  L.push(`PRINT ${Math.max(1, copias)},1`);
  return L.join("\r\n") + "\r\n";
}

// Agrupa etiquetas iguales (misma prenda y precios) para imprimirlas con un solo comando.
export function trabajosTspl(cola: DatosEtiqueta[]) {
  const grupos = new Map<string, { e: DatosEtiqueta; n: number }>();
  for (const e of cola) {
    const k = `${e.sku}|${e.nombre}|${e.precios.map((p) => p.valor).join(",")}|${e.marco ? 1 : 0}`;
    const g = grupos.get(k);
    if (g) g.n++;
    else grupos.set(k, { e, n: 1 });
  }
  return [...grupos.values()].map((g) => etiquetaTspl(g.e, g.n));
}

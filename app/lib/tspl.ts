import JsBarcode from "jsbarcode";
import { empresa } from "./empresa.config";
import type { DatosEtiqueta } from "@/components/Etiqueta";

// La impresora es de 203 dpi: 8 puntos por milimetro. Una etiqueta de 50x30 mm son 400x240 puntos.
const PUNTOS_MM = 8;
const ANCHO_FUENTE: Record<string, number> = { "2": 12, "3": 16 };

const soloAscii = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "").replace(/"/g, "'").trim();
const pesos = (n: number) => "$" + n.toLocaleString("es-AR");

function modulos(texto: string) {
  const o: { encodings?: { data: string }[] } = {};
  JsBarcode(o, texto, { format: "CODE128", displayValue: false });
  return (o.encodings ?? []).reduce((s, e) => s + e.data.length, 0);
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
    "CLS",
  ];
  if (e.marco) L.push(`BOX 0,0,${ancho - 1},${alto - 1},2`);
  L.push(`BARCODE ${barraX},14,"128",88,0,0,2,2,"${sku}"`);
  const maxNombre = Math.floor((ancho - 2 * margen) / ANCHO_FUENTE["2"]);
  L.push(`TEXT ${margen},110,"2",0,1,1,"${`${sku}  ${soloAscii(e.nombre)}`.slice(0, maxNombre)}"`);
  e.precios.slice(0, 2).forEach((p, i) => {
    const t = soloAscii(`${p.nombre}: ${pesos(p.valor)}`);
    const fuente = t.length * ANCHO_FUENTE["3"] <= ancho - 2 * margen ? "3" : "2";
    L.push(`TEXT ${margen},${138 + i * 30},"${fuente}",0,1,1,"${t}"`);
  });
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

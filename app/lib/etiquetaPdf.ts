import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import JsBarcode from "jsbarcode";
import { empresa } from "./empresa.config";
import { textoPrecioEtiqueta } from "./util";
import type { DatosEtiqueta } from "@/components/Etiqueta";

const MM = 72 / 25.4;
// 203 dpi: un punto de la impresora = 0.125 mm. Cada barra fina mide 2 puntos para que no salga borrosa.
const PUNTO = MM / 8;


function barras(texto: string) {
  const o: { encodings?: { data: string }[] } = {};
  JsBarcode(o, texto, { format: "CODE128", displayValue: false });
  return (o.encodings ?? []).map((e) => e.data).join("");
}

// Un PDF con una pagina de 50x30 mm por etiqueta (se repite cada una segun `n`). Se manda a la impresora sin dialogo.
export async function etiquetasPdf(cola: DatosEtiqueta[]) {
  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = empresa.etiquetaMm.ancho * MM;
  const H = empresa.etiquetaMm.alto * MM;
  const margen = 2.2 * MM;

  const recortar = (t: string, f: typeof normal, tam: number, max: number) => {
    if (f.widthOfTextAtSize(t, tam) <= max) return t;
    while (t.length > 1 && f.widthOfTextAtSize(t + "…", tam) > max) t = t.slice(0, -1);
    return t.trimEnd() + "...";
  };

  // El nombre va al lado del SKU; si no entra, el resto sigue en una segunda linea (solo se corta con "..." si tampoco entra ahi).
  const partirNombre = (nombre: string, ancho1: number, ancho2: number, tam: number) => {
    if (normal.widthOfTextAtSize(nombre, tam) <= ancho1) return [nombre];
    const palabras = nombre.split(/\s+/).filter(Boolean);
    let primera = "";
    let i = 0;
    for (; i < palabras.length; i++) {
      const prueba = primera ? `${primera} ${palabras[i]}` : palabras[i];
      if (normal.widthOfTextAtSize(prueba, tam) > ancho1) break;
      primera = prueba;
    }
    const resto = palabras.slice(i).join(" ");
    return primera ? [primera, recortar(resto, normal, tam, ancho2)] : [recortar(nombre, normal, tam, ancho2)];
  };

  for (const e of cola) {
    const p = doc.addPage([W, H]);
    if (e.marco) p.drawRectangle({ x: 0.3 * MM, y: 0.3 * MM, width: W - 0.6 * MM, height: H - 0.6 * MM, borderWidth: 0.6, borderColor: rgb(0, 0, 0) });
    const bits = barras(e.sku || "SKU");
    // Barras gruesas (3 puntos por modulo) si entran en la etiqueta; si no, 2. Cuanto mas anchas, mas facil las lee el lector.
    const modulo = (bits.length * 3 * PUNTO <= W - 2 * margen ? 3 : 2) * PUNTO;
    const x0 = Math.max(margen, (W - bits.length * modulo) / 2);
    const xNombre = margen + negrita.widthOfTextAtSize(e.sku, 8.5) + 2 * MM;
    const lineasNombre = partirNombre(e.nombre, W - margen - xNombre, W - 2 * margen, 7);
    const doble = lineasNombre.length > 1;
    // Con el nombre en dos lineas las barras bajan a 8,5 mm para que entre todo (lo que importa para leer es el ancho de cada barra, no el alto).
    const altoBarras = (doble ? 8.5 : 10) * MM;
    const yBarras = H - (doble ? 1.8 : 2.2) * MM - altoBarras;
    for (let i = 0; i < bits.length; ) {
      if (bits[i] !== "1") { i++; continue; }
      let j = i;
      while (j < bits.length && bits[j] === "1") j++;
      p.drawRectangle({ x: x0 + i * modulo, y: yBarras, width: (j - i) * modulo, height: altoBarras, color: rgb(0, 0, 0) });
      i = j;
    }
    const maxAncho = W - 2 * margen;
    let y = yBarras - 3.2 * MM;
    p.drawText(e.sku, { x: margen, y, size: 8.5, font: negrita });
    p.drawText(lineasNombre[0], { x: xNombre, y, size: 7, font: normal });
    if (doble) {
      y -= 2.7 * MM;
      p.drawText(lineasNombre[1], { x: margen, y, size: 7, font: normal });
    }
    for (const pr of e.precios.slice(0, 3)) {
      y -= (doble ? 3.5 : 3.7) * MM;
      p.drawText(recortar(textoPrecioEtiqueta(pr), negrita, 9.5, maxAncho), { x: margen, y, size: 9.5, font: negrita });
    }
  }
  return doc.save();
}

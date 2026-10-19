import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { empresa } from "./empresa.config";
import { nombreSucursal } from "./util";
import type { Traslado } from "./util";

const MM = 72 / 25.4;
const fecha = (d: Date) => d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });

// Remito interno (no fiscal) de lo enviado de una sucursal a otra, en A4, con lugar para las firmas.
export async function remitoPdf(items: Traslado[], desde: string, hasta: string, numero: string) {
  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 210 * MM, H = 297 * MM, margen = 18 * MM;
  const negro = rgb(0, 0, 0), gris = rgb(0.45, 0.45, 0.45);
  const cortar = (t: string, f: typeof normal, tam: number, max: number) => {
    while (t.length > 1 && f.widthOfTextAtSize(t, tam) > max) t = t.slice(0, -1);
    return t;
  };

  // Agrupa por prenda (un mismo SKU puede estar en varios envios del dia).
  const filas = new Map<string, { sku: string; nombre: string; cantidad: number }>();
  for (const t of items) {
    const f = filas.get(t.sku);
    if (f) f.cantidad += t.cantidad;
    else filas.set(t.sku, { sku: t.sku, nombre: t.nombre, cantidad: t.cantidad });
  }
  const lista = [...filas.values()].sort((a, b) => a.sku.localeCompare(b.sku));
  const total = lista.reduce((s, f) => s + f.cantidad, 0);

  // Logo en negro (se imprime bien en cualquier impresora). Si el archivo no esta, el remito sale igual con el nombre en texto.
  const logo = await readFile(join(process.cwd(), "public", "logo-negro.png")).then((b) => doc.embedPng(b)).catch(() => null);
  let p = doc.addPage([W, H]);
  let y = H - margen;
  const encabezado = () => {
    // El logo ocupa el alto que necesite; el resto del encabezado baja debajo de el.
    const lw = 36 * MM, lh = logo ? (logo.height * lw) / logo.width : 20;
    if (logo) p.drawImage(logo, { x: margen, y: y - lh, width: lw, height: lh });
    else p.drawText(empresa.nombre, { x: margen, y: y - 14, size: 16, font: negrita });
    p.drawText("REMITO INTERNO", { x: W - margen - negrita.widthOfTextAtSize("REMITO INTERNO", 14), y: y - 14, size: 14, font: negrita });
    p.drawText(`N° ${numero}`, { x: W - margen - normal.widthOfTextAtSize(`N° ${numero}`, 10), y: y - 30, size: 10, font: normal });
    p.drawText("Documento interno, no válido como factura", { x: margen, y: y - lh - 12, size: 8.5, font: normal, color: gris });
    y -= lh + 36;
    p.drawText(`Fecha: ${fecha(new Date())}`, { x: margen, y, size: 10.5, font: normal });
    p.drawText(`De: ${nombreSucursal(desde)}`, { x: margen + 120, y, size: 10.5, font: negrita });
    p.drawText(`Para: ${nombreSucursal(hasta)}`, { x: margen + 300, y, size: 10.5, font: negrita });
    y -= 24;
    p.drawRectangle({ x: margen, y: y - 5, width: W - 2 * margen, height: 18, color: rgb(0.92, 0.92, 0.92) });
    p.drawText("SKU", { x: margen + 6, y, size: 9.5, font: negrita });
    p.drawText("Prenda", { x: margen + 90, y, size: 9.5, font: negrita });
    p.drawText("Cant.", { x: W - margen - 40, y, size: 9.5, font: negrita });
    y -= 20;
  };
  encabezado();

  for (const f of lista) {
    if (y < margen + 150) { p = doc.addPage([W, H]); y = H - margen; encabezado(); }
    p.drawText(f.sku, { x: margen + 6, y, size: 10, font: normal });
    p.drawText(cortar(f.nombre, normal, 10, W - 2 * margen - 150), { x: margen + 90, y, size: 10, font: normal });
    p.drawText(String(f.cantidad), { x: W - margen - 12 - normal.widthOfTextAtSize(String(f.cantidad), 10), y, size: 10, font: normal });
    p.drawLine({ start: { x: margen, y: y - 5 }, end: { x: W - margen, y: y - 5 }, thickness: 0.4, color: rgb(0.8, 0.8, 0.8) });
    y -= 17;
  }
  y -= 6;
  p.drawText(`Total: ${total} prendas (${lista.length} modelos)`, { x: margen + 6, y, size: 11, font: negrita });

  const yFirma = margen + 60;
  for (const [x, rotulo] of [[margen, "Entregó (nombre y firma)"], [W / 2 + 10, "Recibió (nombre y firma)"]] as const) {
    p.drawLine({ start: { x, y: yFirma }, end: { x: x + W / 2 - margen - 20, y: yFirma }, thickness: 0.6, color: negro });
    p.drawText(rotulo, { x, y: yFirma - 13, size: 9, font: normal, color: gris });
  }
  return doc.save();
}

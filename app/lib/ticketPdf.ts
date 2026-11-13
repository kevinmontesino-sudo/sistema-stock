import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import JsBarcode from "jsbarcode";
import { CORAZON_SVG, envolver, renglonesVenta } from "./ticketRenglones";
import type { DatosTicket } from "@/components/Ticket";

// Ticket de venta en PDF (para mandar por WhatsApp). Se arma en el momento en la PC o el celular y NO se guarda en ningun lado:
// cualquier ticket, nuevo o viejo, se vuelve a generar desde la venta cuando se lo pide.
const MM = 72 / 25.4;
const ANCHO = 80 * MM;
const MARGEN = 5 * MM;
const COLS = 42; // letras por renglon (letra de ancho fijo)
const TAM = (ANCHO - 2 * MARGEN) / COLS / 0.6; // Courier: cada letra mide 0,6 del tamano
const ALTO_LINEA = TAM * 1.4;

// Las letras estandar del PDF no tienen algunos caracteres: se cambian por equivalentes.
const limpiar = (s: string) => s.replace(/[   ]/g, " ").replace(/[−–—]/g, "-").replace(/[^\x20-\x7e¡-ÿ€…·]/g, "?");

function barras(texto: string) {
  const o: { encodings?: { data: string }[] } = {};
  JsBarcode(o, texto, { format: "CODE128", displayValue: false });
  return (o.encodings ?? []).map((e) => e.data).join("");
}

type Dibujo = (page: import("pdf-lib").PDFPage, y: number) => void;

export async function ticketVentaPdf(venta: DatosTicket) {
  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Courier);
  const negrita = await doc.embedFont(StandardFonts.CourierBold);
  const logoBytes = await fetch("/logo-negro.png").then((r) => r.arrayBuffer()).catch(() => null);
  const logo = logoBytes ? await doc.embedPng(logoBytes).catch(() => null) : null;

  // Primero se calcula cada cosa a dibujar y su alto; despues se crea la hoja del largo justo.
  const pasos: { alto: number; dibujar: Dibujo }[] = [];
  const texto = (s: string, x: number, f: PDFFont, tam = TAM): Dibujo => (page, y) => page.drawText(limpiar(s), { x, y: y - tam, size: tam, font: f, color: rgb(0, 0, 0) });
  const centrado = (s: string, f: PDFFont, tam = TAM) => {
    for (const l of envolver(s, Math.floor(COLS * TAM / tam))) {
      const w = f.widthOfTextAtSize(limpiar(l), tam);
      pasos.push({ alto: tam * 1.4, dibujar: texto(l, (ANCHO - w) / 2, f, tam) });
    }
  };
  if (logo) {
    const w = 56 * MM, h = (logo.height * w) / logo.width;
    pasos.push({ alto: h + 3 * MM, dibujar: (page, y) => page.drawImage(logo, { x: (ANCHO - w) / 2, y: y - h, width: w, height: h }) });
  }
  for (const r of renglonesVenta(venta)) {
    if (r.t === "centro") centrado(r.s, r.negrita ? negrita : normal);
    else if (r.t === "linea") for (const l of envolver(r.s, COLS)) pasos.push({ alto: ALTO_LINEA, dibujar: texto(l, MARGEN, normal) });
    else if (r.t === "regla") pasos.push({ alto: ALTO_LINEA, dibujar: (page, y) => page.drawLine({ start: { x: MARGEN, y: y - ALTO_LINEA / 2 }, end: { x: ANCHO - MARGEN, y: y - ALTO_LINEA / 2 }, thickness: 0.6, dashArray: [2, 2] }) });
    else if (r.t === "izqDer") {
      const tam = r.destacado ? TAM * 1.25 : TAM;
      const f = r.destacado ? negrita : normal;
      const cols = Math.floor(COLS * TAM / tam);
      const partes = envolver(r.izq, Math.max(8, cols - r.der.length - 1));
      partes.forEach((p, i) => {
        const fin = i === partes.length - 1;
        pasos.push({ alto: tam * 1.4, dibujar: (page, y) => {
          texto(p, MARGEN, f, tam)(page, y);
          if (fin) texto(r.der, ANCHO - MARGEN - f.widthOfTextAtSize(limpiar(r.der), tam), f, tam)(page, y);
        } });
      });
    } else if (r.t === "corazon") {
      const lado = r.mm * MM;
      pasos.push({ alto: lado * 0.9 + 1.5 * MM, dibujar: (page, y) => page.drawSvgPath(CORAZON_SVG, { x: (ANCHO - lado) / 2, y, scale: lado / 100, color: rgb(0, 0, 0) }) });
    } else if (r.t === "barras") {
      const bits = barras(r.valor);
      const modulo = Math.min(1.2, (ANCHO - 2 * MARGEN) / bits.length);
      const ancho = bits.length * modulo, alto = 12 * MM;
      pasos.push({ alto: alto + TAM * 2.2, dibujar: (page, y) => {
        const x0 = (ANCHO - ancho) / 2;
        for (let i = 0; i < bits.length; i++) if (bits[i] === "1") page.drawRectangle({ x: x0 + i * modulo, y: y - alto, width: modulo, height: alto, color: rgb(0, 0, 0) });
        const w = normal.widthOfTextAtSize(r.valor, TAM);
        texto(r.valor, (ANCHO - w) / 2, normal)(page, y - alto - TAM * 0.3);
      } });
    }
  }
  const alto = pasos.reduce((s, p) => s + p.alto, 0) + 2 * MARGEN;
  const page = doc.addPage([ANCHO, alto]);
  page.drawRectangle({ x: 0, y: 0, width: ANCHO, height: alto, color: rgb(1, 1, 1) });
  let y = alto - MARGEN;
  for (const p of pasos) { p.dibujar(page, y); y -= p.alto; }
  return doc.save();
}

// Genera el PDF y lo comparte (en el celular abre el menu para mandarlo por WhatsApp) o, en la PC, lo descarga.
export async function compartirTicketPdf(venta: DatosTicket) {
  const bytes = await ticketVentaPdf(venta);
  const nombre = `ticket-${venta.codigo}${venta.regalo ? "-regalo" : ""}.pdf`;
  const archivo = new File([bytes as BlobPart], nombre, { type: "application/pdf" });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  const esCelular = /Android|iPhone|iPad/i.test(navigator.userAgent);
  if (esCelular && nav.canShare?.({ files: [archivo] })) {
    try { await nav.share({ files: [archivo], title: nombre }); return; } catch (e) { if ((e as Error).name === "AbortError") return; }
  }
  const url = URL.createObjectURL(archivo);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

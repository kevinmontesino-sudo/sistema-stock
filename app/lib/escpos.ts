import { empresa } from "./empresa.config";
import { lineasTicket } from "./ticketLineas";
import { DIAS_DEVOLUCION, nombreSucursal, pesos, type NotaCredito } from "./util";
import type { DatosTicket } from "@/components/Ticket";

// Arma el ticket en ESC/POS (el lenguaje de las impresoras de rollo Epson y compatibles) para mandarlo directo con el agente de
// impresion: sin ventana, sin tamano de hoja y con el corte justo. Es el mismo contenido que components/Ticket.tsx y TicketNota.tsx.
const ESC = 0x1b;
const GS = 0x1d;
// Pagina de codigos 858: lo que la impresora entiende para acentos y la enie.
const CP858: Record<string, number> = {
  á: 0xa0, é: 0x82, í: 0xa1, ó: 0xa2, ú: 0xa3, ñ: 0xa4, Ñ: 0xa5, "¿": 0xa8, "¡": 0xad, ü: 0x81, Ü: 0x9a,
  Á: 0xb5, É: 0x90, Í: 0xd6, Ó: 0xe0, Ú: 0xe9, "·": 0xfa, "°": 0xf8,
};

function codificar(s: string) {
  const out: number[] = [];
  for (const ch of s.replace(/[  ]/g, " ")) {
    const c = ch.codePointAt(0)!;
    out.push(c < 128 ? c : CP858[ch] ?? 0x3f);
  }
  return out;
}

// Parte un texto en renglones de hasta `ancho` letras, cortando por palabras.
function envolver(texto: string, ancho: number) {
  const lineas: string[] = [];
  let actual = "";
  for (let palabra of texto.split(/\s+/).filter(Boolean)) {
    while (palabra.length > ancho) {
      if (actual) { lineas.push(actual); actual = ""; }
      lineas.push(palabra.slice(0, ancho));
      palabra = palabra.slice(ancho);
    }
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (prueba.length > ancho) { lineas.push(actual); actual = palabra; } else actual = prueba;
  }
  if (actual) lineas.push(actual);
  return lineas.length ? lineas : [""];
}

class Rollo {
  b: number[] = [];
  constructor(readonly cols: number) {}
  raw(...n: number[]) { this.b.push(...n); return this; }
  init() { return this.raw(ESC, 0x40, ESC, 0x74, 19, ESC, 0x4d, 0); } // reinicia, pagina 858, letra A
  alinear(a: 0 | 1 | 2) { return this.raw(ESC, 0x61, a); }
  negrita(on: boolean) { return this.raw(ESC, 0x45, on ? 1 : 0); }
  alto(on: boolean) { return this.raw(GS, 0x21, on ? 0x01 : 0x00); }
  linea(s = "") { this.b.push(...codificar(s), 0x0a); return this; }
  centro(s: string, negrita = false) {
    this.alinear(1).negrita(negrita);
    for (const l of envolver(s, this.cols)) this.linea(l);
    return this.negrita(false).alinear(0);
  }
  regla() { return this.linea("-".repeat(this.cols)); }
  // Texto a la izquierda y monto a la derecha; si el texto es largo baja de renglon y el monto queda en el ultimo.
  izqDer(izq: string, der: string, destacado = false) {
    this.negrita(destacado).alto(destacado);
    const partes = envolver(izq, Math.max(8, this.cols - der.length - 1));
    partes.forEach((p, i) => this.linea(i === partes.length - 1 ? p.padEnd(this.cols - der.length) + der : p));
    return this.negrita(false).alto(false);
  }
  barras(valor: string) {
    const datos = codificar("{B" + valor);
    this.alinear(1).raw(GS, 0x68, 70, GS, 0x77, 3, GS, 0x48, 2, GS, 0x66, 0, GS, 0x6b, 73, datos.length, ...datos, 0x0a);
    return this.alinear(0);
  }
  cortar() { return this.raw(ESC, 0x64, 5, GS, 0x56, 66, 0); } // avanza el papel y corta
  bytes() { return Uint8Array.from(this.b); }
}

// El logo se dibuja en blanco y negro: la impresora no tiene escala de grises.
async function logoRaster(anchoPuntos: number) {
  const img = new Image();
  img.src = "/logo-negro.png";
  await img.decode();
  const w = Math.floor(anchoPuntos / 8) * 8;
  const h = Math.round((img.naturalHeight * w) / img.naturalWidth);
  const lienzo = document.createElement("canvas");
  lienzo.width = w;
  lienzo.height = h;
  const ctx = lienzo.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const fila = w / 8;
  const out: number[] = [GS, 0x76, 0x30, 0, fila & 255, fila >> 8, h & 255, h >> 8];
  for (let y = 0; y < h; y++) {
    for (let xb = 0; xb < fila; xb++) {
      let v = 0;
      for (let bit = 0; bit < 8; bit++) {
        const i = (y * w + xb * 8 + bit) * 4;
        if ((px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000 < 160) v |= 0x80 >> bit;
      }
      out.push(v);
    }
  }
  return out;
}

const dos = (n: number) => String(n).padStart(2, "0");

async function nuevo() {
  // 80 mm = 48 letras por renglon; 58 mm = 32.
  const r = new Rollo(empresa.ticketMm.ancho >= 80 ? 48 : 32).init();
  const puntos = empresa.ticketMm.ancho >= 80 ? 448 : 320;
  r.alinear(1).raw(...(await logoRaster(puntos))).alinear(0);
  return r;
}

export async function ticketVentaEscpos(venta: DatosTicket) {
  const r = await nuevo();
  const f = new Date(venta.fecha);
  const fecha = `${dos(f.getDate())}/${dos(f.getMonth() + 1)}/${f.getFullYear()} ${dos(f.getHours())}:${dos(f.getMinutes())}`;
  const tope = new Date(f.getTime() + DIAS_DEVOLUCION * 86_400_000);
  const limite = `${dos(tope.getDate())}/${dos(tope.getMonth() + 1)}/${tope.getFullYear()}`;
  const cantidad = venta.items.reduce((s, i) => s + i.cant, 0);
  const unico = venta.pagos.length === 1 ? venta.pagos[0] : null;
  const efectivo = venta.pagos.find((p) => p.medioId === "efectivo");
  const { items, recargo, textoPct, promo, ahorro, sinCambio, todoSinCambio } = lineasTicket(venta);
  r.centro(nombreSucursal(venta.sucursal)).centro(`Ticket ${venta.codigo} · ${fecha}`).regla();
  for (const i of items) r.izqDer(`${i.cant} x ${i.nombre}${i.sinCambio && !todoSinCambio ? " (SIN CAMBIO)" : ""}`, pesos(i.monto));
  r.regla();
  if (recargo) r.linea(`${cantidad} prendas`);
  else r.izqDer(`${cantidad} prendas · subtotal lista`, pesos(venta.subtotal));
  if (venta.promo) r.izqDer(venta.promo.nombre, `-${pesos(promo)}`);
  if (venta.ajuste < 0) {
    r.izqDer(unico ? `${unico.nombre}${textoPct(unico.pct)}` : "Descuento por medios de pago", `-${pesos(Math.abs(venta.ajuste))}`);
  }
  r.izqDer("TOTAL", pesos(venta.total), true);
  if (ahorro > 0) r.izqDer("AHORRASTE", pesos(ahorro));
  r.regla();
  for (const p of venta.pagos) r.izqDer(`Paga ${p.nombre}${textoPct(p.pct)}`, pesos(p.monto));
  if (venta.recibido !== undefined && efectivo) {
    r.izqDer("Efectivo recibido", pesos(venta.recibido)).izqDer("VUELTO", pesos(venta.recibido - efectivo.monto), true);
  }
  r.regla().barras(venta.codigo);
  if (todoSinCambio) r.centro("VENTA SIN CAMBIO", true);
  else {
    r.centro(`Cambios por ${DIAS_DEVOLUCION} días`, true).centro(`Hasta el ${limite} presentando este ticket.`);
    if (sinCambio) r.centro("Las prendas marcadas SIN CAMBIO no tienen cambio.");
  }
  r.linea().centro("¡Gracias por tu compra!", true).centro("Te esperamos pronto", true).linea()
    .centro("Ticket interno").centro("No válido como factura")
    .cortar();
  return r.bytes();
}

export async function ticketNotaEscpos(nota: NotaCredito) {
  const r = await nuevo();
  r.centro(nombreSucursal(nota.sucursal)).centro("NOTA DE CRÉDITO", true)
    .centro(`N° ${nota.codigo} · Ticket de compra ${nota.ventaCodigo}`)
    .centro(`Emitida: ${new Date(nota.creada).toLocaleDateString("es-AR")}`).regla();
  for (const i of nota.items) r.izqDer(`${i.cantidad} x ${i.nombre}`, pesos(i.monto));
  r.regla().izqDer("VALOR", pesos(nota.montoInicial), true);
  if (nota.saldo !== nota.montoInicial) r.izqDer("Saldo disponible", pesos(nota.saldo));
  r.linea().centro("Sin vencimiento", true).barras(nota.codigo)
    .centro("Presentala en la caja: se descuenta del total de tu compra.").regla()
    .centro("Documento interno").centro("No válido como factura")
    .cortar();
  return r.bytes();
}

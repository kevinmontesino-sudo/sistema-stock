import { empresa } from "./empresa.config";
import { CORAZON_SVG, envolver, renglonesVenta } from "./ticketRenglones";
import { nombreSucursal, pesos, type NotaCredito } from "./util";
import type { DatosTicket } from "@/components/Ticket";
import type { CierreCaja, MedioDia } from "./cierre";

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

// Dibujos (logo, corazon) en blanco y negro: la impresora no tiene escala de grises.
function raster(anchoPuntos: number, alto: number, dibujar: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
  const w = Math.floor(anchoPuntos / 8) * 8;
  const h = Math.max(1, Math.round(alto));
  const lienzo = document.createElement("canvas");
  lienzo.width = w;
  lienzo.height = h;
  const ctx = lienzo.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  dibujar(ctx, w, h);
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

async function logoRaster(anchoPuntos: number) {
  const img = new Image();
  img.src = "/logo-negro.png";
  await img.decode();
  const w = Math.floor(anchoPuntos / 8) * 8;
  return raster(w, (img.naturalHeight * w) / img.naturalWidth, (ctx, ww, hh) => ctx.drawImage(img, 0, 0, ww, hh));
}

// Corazon centrado, de `mm` milimetros de ancho (203 dpi: 8 puntos por mm).
function corazonRaster(anchoPapelPuntos: number, mm: number) {
  const lado = mm * 8;
  return raster(anchoPapelPuntos, lado * 0.9, (ctx, w) => {
    ctx.translate((w - lado) / 2, 0);
    ctx.scale(lado / 100, lado / 100);
    ctx.fillStyle = "#000";
    ctx.fill(new Path2D(CORAZON_SVG));
  });
}

const dos = (n: number) => String(n).padStart(2, "0");

async function nuevo() {
  // 80 mm = 48 letras por renglon; 58 mm = 32.
  const r = new Rollo(empresa.ticketMm.ancho >= 80 ? 48 : 32).init();
  const puntos = empresa.ticketMm.ancho >= 80 ? 448 : 320;
  r.alinear(1).raw(...(await logoRaster(puntos))).alinear(0);
  return r;
}

// Venta marcada como regalo: dos tickets cortados, uno para el que compro (con importe) y otro de regalo (sin precios).
export async function ticketsVentaEscpos(venta: DatosTicket, conRegalo: boolean) {
  const a = await ticketVentaEscpos({ ...venta, regalo: false });
  if (!conRegalo) return a;
  const b = await ticketVentaEscpos({ ...venta, regalo: true, recibido: undefined });
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

export async function ticketVentaEscpos(venta: DatosTicket) {
  const r = await nuevo();
  for (const x of renglonesVenta(venta)) {
    if (x.t === "centro") r.centro(x.s, x.negrita);
    else if (x.t === "izqDer") r.izqDer(x.izq, x.der, x.destacado);
    else if (x.t === "linea") { if (x.s) for (const l of envolver(x.s, r.cols)) r.linea(l); else r.linea(); }
    else if (x.t === "regla") r.regla();
    else if (x.t === "corazon") r.raw(...corazonRaster(r.cols >= 48 ? 448 : 320, x.mm));
    else r.barras(x.valor);
  }
  r.cortar();
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

// Ticket del cierre de caja (rollo): lo que se cobro, lo que se conto y la diferencia. Se guarda en la carpeta del local.
export async function ticketCierreEscpos(c: CierreCaja, medios: MedioDia[]) {
  const r = await nuevo();
  const [a, m, d] = c.dia.split("-");
  const hora = new Date(c.creado);
  r.centro(nombreSucursal(c.sucursal)).centro("CIERRE DE CAJA", true).centro(`Día ${d}/${m}/${a}`)
    .centro(`Cerrado ${dos(hora.getDate())}/${dos(hora.getMonth() + 1)} ${dos(hora.getHours())}:${dos(hora.getMinutes())} por ${c.cerradoPor}`).regla();
  r.izqDer(`${c.ventas} ventas · ${c.unidades} prendas`, pesos(medios.reduce((s, x) => s + x.monto, 0)), true);
  for (const x of medios) r.izqDer(`${x.nombre} (${x.ventas})`, pesos(x.monto));
  if (c.notasEmitidas > 0) r.izqDer(`Notas de crédito emitidas (${c.notasEmitidas})`, pesos(c.notasMonto));
  r.regla().centro("EFECTIVO", true);
  r.izqDer("Fondo con que abrió", pesos(c.fondoInicial)).izqDer("+ Cobrado en efectivo", pesos(c.esperado.efectivo ?? 0));
  if (c.retiros > 0) r.izqDer(`- Retiros: ${c.retirosMotivo ?? ""}`, pesos(c.retiros));
  r.izqDer("Debería haber", pesos(c.efectivoEsperado)).izqDer("Contado", pesos(c.efectivoContado));
  r.izqDer(c.diferencia === 0 ? "DIFERENCIA" : c.diferencia > 0 ? "SOBRA" : "FALTA", c.diferencia === 0 ? "$0 · OK" : pesos(Math.abs(c.diferencia)), true);
  const otros = Object.entries(c.contado).filter(([id]) => id !== "efectivo");
  if (otros.length) {
    r.regla().centro("OTROS MEDIOS (lo que contó el local)");
    for (const [id, v] of otros) {
      const nombre = medios.find((x) => x.id === id)?.nombre ?? id, esp = c.esperado[id] ?? 0;
      r.izqDer(`${nombre} contado`, pesos(v)).izqDer(`  sistema ${pesos(esp)}  dif.`, v - esp === 0 ? "$0" : `${v - esp > 0 ? "+" : "-"}${pesos(Math.abs(v - esp))}`);
    }
  }
  if (c.observaciones) r.regla().linea("Obs: " + c.observaciones);
  r.regla().linea().linea().centro("Firma: ______________________").cortar();
  return r.bytes();
}

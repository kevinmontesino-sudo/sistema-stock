import { lineasTicket } from "./ticketLineas";
import { DIAS_DEVOLUCION, nombreSucursal, pesos } from "./util";
import type { DatosTicket } from "@/components/Ticket";

// Contenido del ticket de venta como una lista de renglones. Lo usan la impresora de rollo (escpos.ts) y el PDF para WhatsApp
// (ticketPdf.ts), asi los dos dicen exactamente lo mismo. components/Ticket.tsx es la version en pantalla.
// Ticket de regalo (venta.regalo): sin precios; el importe dice INVALUABLE. El codigo de barras es el mismo, asi que el cambio
// y la devolucion funcionan como siempre.
export type Renglon =
  | { t: "centro"; s: string; negrita?: boolean }
  | { t: "izqDer"; izq: string; der: string; destacado?: boolean }
  | { t: "linea"; s: string }
  | { t: "regla" }
  | { t: "barras"; valor: string }
  | { t: "corazon"; mm: number }; // dibujo de un corazon centrado (ticket de regalo), de `mm` milimetros de ancho

const dos = (n: number) => String(n).padStart(2, "0");
export const fechaTicket = (iso: string) => {
  const f = new Date(iso);
  return `${dos(f.getDate())}/${dos(f.getMonth() + 1)}/${f.getFullYear()} ${dos(f.getHours())}:${dos(f.getMinutes())}`;
};
export const limiteCambio = (iso: string) => {
  const t = new Date(new Date(iso).getTime() + DIAS_DEVOLUCION * 86_400_000);
  return `${dos(t.getDate())}/${dos(t.getMonth() + 1)}/${t.getFullYear()}`;
};
export const TEXTO_REGALO = {
  titulo: "TICKET DE REGALO", dedicatoria: "Alguien pensó en vos y te eligió esto con mucho cariño",
  importe: "IMPORTE", valor: "INVALUABLE", despedida: "¡Que lo disfrutes!",
};
// Corazon en una caja de 100 x 90 (el mismo dibujo en la impresora, el PDF y la pantalla).
export const CORAZON_SVG = "M50 88 C20 66 4 49 4 30 C4 15 15 4 29 4 C39 4 46 10 50 19 C54 10 61 4 71 4 C85 4 96 15 96 30 C96 49 80 66 50 88 Z";

export function renglonesVenta(venta: DatosTicket): Renglon[] {
  const r: Renglon[] = [];
  const cantidad = venta.items.reduce((s, i) => s + i.cant, 0);
  const unico = venta.pagos.length === 1 ? venta.pagos[0] : null;
  const efectivo = venta.pagos.find((p) => p.medioId === "efectivo");
  const { items, recargo, textoPct, promo, ahorro, sinCambio, todoSinCambio } = lineasTicket(venta);
  r.push({ t: "centro", s: nombreSucursal(venta.sucursal) }, { t: "centro", s: `Ticket ${venta.codigo} · ${fechaTicket(venta.fecha)}` });
  if (venta.regalo) {
    r.push({ t: "linea", s: "" }, { t: "corazon", mm: 16 }, { t: "centro", s: TEXTO_REGALO.titulo, negrita: true }, { t: "centro", s: TEXTO_REGALO.dedicatoria });
  }
  r.push({ t: "regla" });
  for (const i of items) {
    const nombre = `${i.cant} x ${i.nombre}${i.sinCambio && !todoSinCambio ? " (SIN CAMBIO)" : ""}`;
    r.push(venta.regalo ? { t: "linea", s: nombre } : { t: "izqDer", izq: nombre, der: pesos(i.monto) });
  }
  r.push({ t: "regla" });
  if (venta.regalo) {
    r.push({ t: "linea", s: `${cantidad} ${cantidad === 1 ? "prenda" : "prendas"}` });
    r.push({ t: "izqDer", izq: TEXTO_REGALO.importe, der: TEXTO_REGALO.valor, destacado: true });
  } else {
    if (recargo) r.push({ t: "linea", s: `${cantidad} prendas` });
    else r.push({ t: "izqDer", izq: `${cantidad} prendas · subtotal lista`, der: pesos(venta.subtotal) });
    if (venta.promo) r.push({ t: "izqDer", izq: venta.promo.nombre, der: `-${pesos(promo)}` });
    if (venta.ajuste < 0) {
      r.push({ t: "izqDer", izq: unico ? `${unico.nombre}${textoPct(unico.pct, unico.medioId)}` : "Descuento por medios de pago", der: `-${pesos(Math.abs(venta.ajuste))}` });
    }
    r.push({ t: "izqDer", izq: "TOTAL", der: pesos(venta.total), destacado: true });
    if (ahorro > 0) r.push({ t: "izqDer", izq: "AHORRASTE", der: pesos(ahorro) });
    r.push({ t: "regla" });
    for (const p of venta.pagos) r.push({ t: "izqDer", izq: `Paga ${p.nombre}${textoPct(p.pct, p.medioId)}`, der: pesos(p.monto) });
    if (venta.recibido !== undefined && efectivo) {
      r.push({ t: "izqDer", izq: "Efectivo recibido", der: pesos(venta.recibido) });
      r.push({ t: "izqDer", izq: "VUELTO", der: pesos(venta.recibido - efectivo.monto), destacado: true });
    }
  }
  r.push({ t: "regla" }, { t: "barras", valor: venta.codigo });
  if (todoSinCambio) r.push({ t: "centro", s: "VENTA SIN CAMBIO", negrita: true });
  else {
    r.push({ t: "centro", s: `Cambios por ${DIAS_DEVOLUCION} días`, negrita: true }, { t: "centro", s: `Hasta el ${limiteCambio(venta.fecha)} presentando este ticket.` });
    if (sinCambio) r.push({ t: "centro", s: "Las prendas marcadas SIN CAMBIO no tienen cambio." });
  }
  if (venta.regalo) r.push({ t: "linea", s: "" }, { t: "centro", s: TEXTO_REGALO.despedida, negrita: true }, { t: "corazon", mm: 6 }, { t: "linea", s: "" });
  else r.push({ t: "linea", s: "" }, { t: "centro", s: "¡Gracias por tu compra!", negrita: true }, { t: "centro", s: "Te esperamos pronto", negrita: true }, { t: "linea", s: "" });
  r.push(
    { t: "centro", s: "Ticket interno" }, { t: "centro", s: "No válido como factura" });
  return r;
}

// Parte un texto en renglones de hasta `ancho` letras, cortando por palabras.
export function envolver(texto: string, ancho: number) {
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

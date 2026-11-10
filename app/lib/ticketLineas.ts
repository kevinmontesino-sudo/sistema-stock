import type { DatosTicket } from "@/components/Ticket";
import { pctTexto } from "./util";

// Lo que se muestra en el ticket (pantalla e impresora). El ticket muestra solo los DESCUENTOS (ej. "Efectivo (-30%)"): un recargo
// (si algun medio lo tiene) nunca se nombra ni se muestra como porcentaje. Con recargo, cada prenda y la promo salen con el recargo
// incluido (una prenda de $30.000 con un medio +20% figura a $36.000) y la cuenta cierra con el total (el redondeo se
// absorbe en el ultimo renglon). Una nota de credito nunca muestra porcentaje (es una conversion de lo que se pago, puede ser 16,6667). `promo` es el monto de la promo a mostrar y `ahorro` lo que se ahorro el cliente.
export function lineasTicket(v: DatosTicket) {
  const recargo = v.ajuste > 0;
  let items = v.items.map((i) => ({ cant: i.cant, nombre: i.nombre, monto: i.precio * i.cant, sinCambio: !!i.sinCambio }));
  let promo = v.promo?.monto ?? 0;
  const neto = v.subtotal - promo;
  if (recargo && neto > 0) {
    const f = v.total / neto;
    promo = Math.round(promo * f);
    const objetivo = v.total + promo;
    items = items.map((i) => ({ ...i, monto: Math.round(i.monto * f) }));
    if (items.length) items[items.length - 1].monto += objetivo - items.reduce((s, i) => s + i.monto, 0);
  }
  const ahorro = recargo ? promo : Math.max(0, v.subtotal - v.total);
  const sinCambio = items.some((i) => i.sinCambio);
  const todoSinCambio = items.length > 0 && items.every((i) => i.sinCambio);
  // El porcentaje de un medio solo se muestra si es descuento, redondeado a 1 decimal como mucho ("-33,3%", nunca "-33.3333%").
  const textoPct = (pct: number, medioId = "") => (pct < 0 && !medioId.startsWith("nota") ? ` (-${pctTexto(pct)})` : "");
  return { items, recargo, textoPct, promo, ahorro, sinCambio, todoSinCambio };
}

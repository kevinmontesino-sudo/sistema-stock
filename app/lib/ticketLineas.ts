import type { DatosTicket } from "@/components/Ticket";

// Lo que se muestra en el ticket (pantalla e impresora). El ticket muestra solo los DESCUENTOS (ej. "Efectivo -20%"): un recargo
// (ej. tarjeta) nunca se nombra ni se muestra como porcentaje. Con recargo, el precio de cada prenda sale ya con el recargo
// incluido y la suma cierra con el total (el redondeo se absorbe en el ultimo renglon).
export function lineasTicket(v: DatosTicket) {
  const recargo = v.ajuste > 0;
  let items = v.items.map((i) => ({ cant: i.cant, nombre: i.nombre, monto: i.precio * i.cant }));
  if (recargo && v.subtotal > 0) {
    const f = v.total / v.subtotal;
    items = items.map((i) => ({ ...i, monto: Math.round(i.monto * f) }));
    if (items.length) items[items.length - 1].monto += v.total - items.reduce((s, i) => s + i.monto, 0);
  }
  // El porcentaje de un medio solo se muestra si es descuento.
  const textoPct = (pct: number) => (pct < 0 ? ` (-${Math.abs(pct)}%)` : "");
  return { items, recargo, textoPct };
}

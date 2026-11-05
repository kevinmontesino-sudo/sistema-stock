// Calculo de promos. Es codigo puro (sin base): lo usan la caja (para mostrar el total antes de cobrar), la oficina (vista previa)
// y el servidor, que es el que vale: vuelve a leer las promos de la base y recalcula todo al registrar la venta.
import type { MedioPago } from "./util";

export type TipoPromo = "nxm" | "porcentaje" | "precio";
export type Promo = {
  id: number; nombre: string; tipo: TipoPromo;
  n: number | null;       // nxm: lleva n. precio: minimo de prendas (null = desde la primera)
  m: number | null;       // nxm: paga m
  pct: number | null;     // porcentaje
  precio: number | null;  // precio: $ por prenda
  tipos: string[]; sucursales: string[]; desde: string; hasta: string;
  descuentoEfectivo: boolean; // si ademas corre el descuento de efectivo (la tarjeta siempre lleva su recargo)
  sinCambio: boolean;         // las prendas que entran quedan sin cambio
  categorias?: string[];      // nombres de las categorias (para mostrar)
};
export type ItemPromo = { tipo: string; precio: number; cant: number };
export type Detalle = {
  descuento: number;
  porItem: number[];  // cuanto se descuenta en cada renglon del carrito
  gratis: number[];   // nxm: cuantas unidades de cada renglon van gratis
  entran: boolean[];  // renglones que entran en la promo
};
export type PromoAplicada = { promo: Promo | null; descuento: number; detalle: Detalle | null };

// Tope del descuento especial que puede hacer un encargado, y de las promos por porcentaje.
export const TOPE_PCT = 50;

const pesos = (n: number) => "$" + n.toLocaleString("es-AR");
const entra = (p: Pick<Promo, "tipos">, i: ItemPromo) => p.tipos.length === 0 || p.tipos.includes(i.tipo);
const cuantas = (n: number, una: string, varias: string) => (n === 1 ? una : varias);

// Rotulo corto: "3x2", "20% off", "$4.500 c/u", "$9.690 c/u x12+".
export function textoPromo(p: Pick<Promo, "tipo" | "n" | "m" | "pct" | "precio">) {
  if (p.tipo === "nxm") return `${p.n}x${p.m}`;
  if (p.tipo === "porcentaje") return `${Number(p.pct)}% off`;
  return `${pesos(p.precio ?? 0)} c/u${p.n && p.n > 1 ? ` x${p.n}+` : ""}`;
}

// Que hace la promo, en una frase para el cajero y para la oficina. Ej.: "Llevando 3 prendas, la más barata va gratis".
export function descripcionPromo(p: Pick<Promo, "tipo" | "n" | "m" | "pct" | "precio" | "sinCambio" | "descuentoEfectivo"> & { categorias?: string[] }) {
  const cats = p.categorias?.length ? p.categorias.join(", ").toLowerCase() : "";
  const de = cats ? ` (${cats})` : "";
  let s: string;
  if (p.tipo === "nxm") {
    const gratis = (p.n ?? 0) - (p.m ?? 0);
    s = `Llevando ${p.n} prendas${de}, ${gratis === 1 ? "la más barata va gratis" : `las ${gratis} más baratas van gratis`}`;
  } else if (p.tipo === "porcentaje") {
    s = `${Number(p.pct)}% off en ${cats || "todas las prendas"}`;
  } else {
    s = p.n && p.n > 1 ? `Llevando ${p.n} o más prendas${de}, cada una a ${pesos(p.precio ?? 0)}` : `${cats ? cats.charAt(0).toUpperCase() + cats.slice(1) : "Todas las prendas"} a ${pesos(p.precio ?? 0)} c/u`;
  }
  if (!p.descuentoEfectivo) s += " (sin el descuento de efectivo)";
  if (p.sinCambio) s += " · SIN CAMBIO";
  return s;
}

// Descuento de UNA promo sobre el carrito (a precio de lista), renglon por renglon.
// NxM: de las prendas que entran, por cada grupo de N se regalan N-M; las que no se pagan son SIEMPRE las mas baratas del carrito.
//      Ej. 3x2 con $30.000, $17.500 y $17.500: no se paga una de $17.500. Con 4 prendas se regala 1; con 6, 2.
// Porcentaje: se redondea renglon por renglon.  Precio: cada prenda a $X (si vale menos, queda a su precio), con minimo de unidades.
export function detalleDe(p: Promo, items: ItemPromo[]): Detalle {
  const porItem = items.map(() => 0);
  const gratis = items.map(() => 0);
  const entran = items.map((i) => i.cant > 0 && entra(p, i));
  const unidades = items.reduce((s, i, k) => s + (entran[k] ? i.cant : 0), 0);
  if (p.tipo === "porcentaje") {
    items.forEach((i, k) => { if (entran[k]) porItem[k] = Math.round((i.precio * i.cant * Number(p.pct)) / 100); });
  } else if (p.tipo === "precio") {
    if (p.precio && p.precio > 0 && unidades >= (p.n ?? 1)) {
      items.forEach((i, k) => { if (entran[k]) porItem[k] = Math.max(0, i.precio - p.precio!) * i.cant; });
    }
  } else {
    const n = p.n ?? 0, m = p.m ?? 0;
    if (n >= 2 && m >= 1 && m < n) {
      const u = items.flatMap((i, k) => (entran[k] ? Array.from({ length: i.cant }, () => ({ k, precio: i.precio })) : []))
        .sort((a, b) => a.precio - b.precio || a.k - b.k);
      for (const x of u.slice(0, Math.floor(u.length / n) * (n - m))) { porItem[x.k] += x.precio; gratis[x.k]++; }
    }
  }
  return { descuento: porItem.reduce((s, x) => s + x, 0), porItem, gratis, entran };
}

export const descuentoDe = (p: Promo, items: ItemPromo[]) => detalleDe(p, items).descuento;

// Las promos no se acumulan: se aplica la que mas descuenta (si empatan, la primera).
export function mejorPromo(promos: Promo[], items: ItemPromo[]): PromoAplicada {
  let mejor: PromoAplicada = { promo: null, descuento: 0, detalle: null };
  for (const p of promos) {
    const d = detalleDe(p, items);
    if (d.descuento > mejor.descuento) mejor = { promo: p, descuento: d.descuento, detalle: d };
  }
  return mejor;
}

// Aviso para el cajero cuando al cliente le faltan pocas prendas para una promo que le convendria MAS que la que ya tiene.
// Ej.: "Sumá 1 prenda más y se lleva otra gratis (3x2)", "Con 3 mallas más llega a 12 y cada una sale $9.690".
export function sugerenciaPromo(promos: Promo[], items: ItemPromo[], actual: number) {
  let mejor: { promo: Promo; faltan: number; texto: string } | null = null;
  for (const p of promos) {
    if (p.tipo === "porcentaje") continue;
    const u = items.reduce((s, i) => s + (entra(p, i) ? i.cant : 0), 0);
    if (u === 0) continue;
    const meta = p.tipo === "nxm" ? (p.n ?? 0) : (p.n ?? 1);
    const faltan = p.tipo === "nxm" ? (meta - (u % meta)) % meta : Math.max(0, meta - u);
    if (p.tipo === "nxm" && faltan === 0) continue;
    if (faltan === 0 || faltan > 4) continue;
    // Solo si sumando esas prendas (de las mas baratas que lleva) el descuento supera al actual.
    const barata = Math.min(...items.filter((i) => entra(p, i)).map((i) => i.precio));
    const conMas = detalleDe(p, [...items, { tipo: items.find((i) => entra(p, i) && i.precio === barata)!.tipo, precio: barata, cant: faltan }]).descuento;
    if (conMas <= actual) continue;
    const que = p.categorias?.length ? p.categorias.join("/").toLowerCase() : cuantas(faltan, "prenda", "prendas");
    const texto = p.tipo === "nxm"
      ? `Sumá ${faltan} ${que} más y ${(p.n ?? 0) - (p.m ?? 0) === 1 ? "se lleva otra gratis" : `se lleva ${(p.n ?? 0) - (p.m ?? 0)} gratis`} (${textoPromo(p)})`
      : `Con ${faltan} ${que} más llega a ${meta} y cada una sale ${pesos(p.precio ?? 0)}`;
    if (!mejor || faltan < mejor.faltan) mejor = { promo: p, faltan, texto };
  }
  return mejor;
}

// Descuento especial: porcentaje sobre todo el carrito. Reemplaza a las promos automaticas (no se suman).
export const descuentoEspecial = (subtotal: number, pct: number) => Math.round((subtotal * pct) / 100);

// Si la promo ganadora no lleva el descuento de efectivo: los medios con descuento pasan a 0% (los recargos quedan igual).
// Las notas de credito no se tocan: su porcentaje es una conversion de lo que se pago, no un descuento.
export const mediosParaPromo = (medios: MedioPago[], promo: Pick<Promo, "descuentoEfectivo"> | null) =>
  !promo || promo.descuentoEfectivo ? medios : medios.map((m) => (m.id.startsWith("nota:") || m.ajustePct >= 0 ? m : { ...m, ajustePct: 0 }));

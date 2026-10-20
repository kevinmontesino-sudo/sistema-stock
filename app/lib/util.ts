import type { PrecioEtiqueta } from "@/components/Etiqueta";
import { empresa } from "./empresa.config";

export type Producto = {
  sku: string;
  tipo: string;
  nombre: string;
  precio: number;
  stock: Record<string, number>;
  foto: string | null;
  creado: string;
  ultimoIngreso: string;
  // Unidades enviadas a cada sucursal que todavia no fueron recibidas (destino -> cantidad).
  enCamino: Record<string, number>;
};
export type Traslado = {
  id: number; sku: string; nombre: string; cantidad: number; recibidas: number; desde: string; hasta: string; fecha: string;
};
export type MedioPago = { id: string; nombre: string; ajustePct: number };
export type Reparto = Record<string, number>;
export type Resultado<T = object> = ({ ok: true } & T) | { ok: false; motivo: string };

export const normalizar = (s: string) =>
  s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");

// Texto de una linea de precio de la etiqueta: "Efectivo: $ 14.000" o "3 cuotas de $ 6.400".
export const textoPrecioEtiqueta = (p: { nombre: string; valor: number; cuotas?: number }) =>
  p.cuotas ? `${p.cuotas} cuotas de ${pesos(p.valor)}` : `${p.nombre}: ${pesos(p.valor)}`;

export const pesos = (n: number) => "$ " + n.toLocaleString("es-AR");

export function fechaCorta(iso: string) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function capitalizar(s: string) {
  const t = s.trim().replace(/\s+/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export type Tipo = { codigo: string; nombre: string; alias: string[]; usos: number };

// Detecta la categoria por las palabras del nombre ("pantalon de gabardina" -> Pantalon). Si ninguna coincide, no hay categoria.
export function tipoDesdeNombre(nombre: string, tipos: Tipo[]): Tipo | undefined {
  for (const palabra of normalizar(nombre).split(" ").filter(Boolean)) {
    const t = tipos.find((x) => x.codigo !== "OTR" && (x.alias.includes(palabra) || normalizar(x.nombre) === palabra));
    if (t) return t;
  }
  return undefined;
}

export const nombreTipo = (codigo: string, tipos: Tipo[]) => tipos.find((t) => t.codigo === codigo)?.nombre ?? codigo;
// Precio segun medio de pago: transferencia = lista (0%), efectivo = -20%, etc. El porcentaje sale de la base.
export const precioMedio = (precio: number, ajustePct: number) => Math.round(precio * (1 + ajustePct / 100));

export const nombreSucursal = (id: string | null) => empresa.sucursales.find((s) => s.id === id)?.nombre ?? "—";
export const totalReparto = (r: Reparto) => Object.values(r).reduce((s, n) => s + n, 0);

// ---- Pagos: cada medio cubre una parte del valor de lista con su propio ajuste ----
// monto = plata que el cliente entrega en ese medio. El medio con monto null paga el resto.
// Ej: lista 100.000, transferencia 50.000 (cubre 50.000 de lista) + efectivo el resto: 50.000 x 0,80 = 40.000. Total 90.000.
export type PagoEntrada = { medioId: string; monto: number | null };
export type PagoCalculado = { medioId: string; nombre: string; pct: number; monto: number; valorLista: number };

export function calcularPagos(
  subtotal: number,
  medios: MedioPago[],
  pagos: PagoEntrada[],
): { ok: true; pagos: PagoCalculado[]; total: number } | { ok: false; motivo: string } {
  if (pagos.length === 0) return { ok: false, motivo: "Elegí cómo paga el cliente" };
  const vistos = new Set<string>();
  const calc: PagoCalculado[] = [];
  let cubierto = 0;
  let resto: MedioPago | undefined;
  for (const p of pagos) {
    const m = medios.find((x) => x.id === p.medioId);
    if (!m) return { ok: false, motivo: "Medio de pago inexistente" };
    if (vistos.has(m.id)) return { ok: false, motivo: `${m.nombre} está repetido` };
    vistos.add(m.id);
    if (p.monto === null) {
      if (resto) return { ok: false, motivo: "Solo un medio puede quedarse con el resto" };
      resto = m;
      continue;
    }
    if (!Number.isInteger(p.monto) || p.monto <= 0) return { ok: false, motivo: `Ingresá un monto válido para ${m.nombre}` };
    const valorLista = Math.round(p.monto / (1 + m.ajustePct / 100));
    cubierto += valorLista;
    calc.push({ medioId: m.id, nombre: m.nombre, pct: m.ajustePct, monto: p.monto, valorLista });
  }
  if (!resto) return { ok: false, motivo: "Elegí qué medio paga el resto" };
  const falta = subtotal - cubierto;
  // Se tolera 1 peso de sobra: sale de redondear lo que cubre una nota de credito.
  if (falta < -1) return { ok: false, motivo: "Lo que entrega el cliente supera el total de la compra" };
  if (falta > 0) {
    calc.push({ medioId: resto.id, nombre: resto.nombre, pct: resto.ajustePct, monto: Math.round(falta * (1 + resto.ajustePct / 100)), valorLista: falta });
  }
  return { ok: true, pagos: calc, total: calc.reduce((s, p) => s + p.monto, 0) };
}

// ---- Notas de credito (devoluciones) ----
// Codigo del ticket: V + 8 caracteres al azar (no secuencial: no deja calcular cuantas ventas hace el negocio).
export const ES_CODIGO_VENTA = /^v[0-9a-f]{8}$/i;
// Codigo de nota: N + 10 caracteres al azar (no adivinable: la nota es plata al portador).
export const ES_CODIGO_NOTA = /^n[0-9a-f]{10}$/i;
export const ES_ESCANEO_NOTA = ES_CODIGO_NOTA;
// La nota de credito no vence; lo que tiene limite es devolver una compra: hasta 15 dias despues.
export const DIAS_DEVOLUCION = 15;

export type NotaCredito = {
  codigo: string; ventaCodigo: string; sucursal: string; creada: string;
  montoInicial: number; saldo: number; ajustePct: number;
  estado: "vigente" | "usada";
  items: { nombre: string; cantidad: number; monto: number; falladas: number }[];
};
export type VentaDevolvible = {
  codigo: string; fecha: string; sucursal: string; total: number;
  items: { id: number; sku: string; nombre: string; precio: number; vendidas: number; devueltas: number; valor: number }[];
};
// Cuanto de una nota se usa en una compra de `subtotal` (a precio de lista): lo que alcance, sin pasarse del total.
// Si alcanza para todo, busca el monto que cubre el subtotal justo (el redondeo del ajuste puede dejar 1 peso de diferencia).
export function montoNotaAplicable(subtotal: number, saldo: number, ajustePct: number) {
  const k = 1 + ajustePct / 100;
  const total = Math.round(subtotal * k);
  if (saldo < total - 1) return Math.max(0, saldo);
  const justo = [total, total - 1, total + 1].find((m) => m <= saldo && Math.round(m / k) === subtotal);
  return justo ?? Math.min(saldo, total);
}

// Reparto automatico: de `stock` unidades, cuantas van a cada destino segun sus porcentajes.
// Se redondea hacia abajo y las unidades que sobran van al destino con mas porcentaje; si los porcentajes suman menos de 100, el resto queda en el origen.
export function repartoPorPorcentaje(stock: number, pct: Record<string, number>): Reparto {
  const ids = Object.keys(pct).filter((k) => pct[k] > 0);
  const suma = ids.reduce((s, k) => s + pct[k], 0);
  if (stock <= 0 || ids.length === 0 || suma > 100) return {};
  const out: Reparto = {};
  for (const k of ids) out[k] = Math.floor((stock * pct[k]) / 100);
  const objetivo = Math.round((stock * suma) / 100);
  const mayor = ids.reduce((a, b) => (pct[b] > pct[a] ? b : a));
  out[mayor] += Math.max(0, objetivo - ids.reduce((s, k) => s + out[k], 0));
  return Object.fromEntries(Object.entries(out).filter(([, n]) => n > 0));
}

// Precios que se imprimen: transferencia (= lista) y efectivo, con el porcentaje que figura en la base.
export function preciosDe(precio: number, medios: MedioPago[]): PrecioEtiqueta[] {
  const p: PrecioEtiqueta[] = empresa.etiquetaMedios.flatMap((id) => {
    const m = medios.find((x) => x.id === id);
    return m ? [{ nombre: m.nombre, valor: precioMedio(precio, m.ajustePct) }] : [];
  });
  // Cuotas: precio con el recargo de la tarjeta dividido en la cantidad de cuotas (redondeado al peso).
  const { medio, cantidad } = empresa.etiquetaCuotas;
  const mc = medios.find((x) => x.id === medio);
  if (mc && cantidad > 0) p.push({ nombre: `${cantidad} cuotas`, valor: Math.round(precioMedio(precio, mc.ajustePct) / cantidad), cuotas: cantidad } );
  return p.length ? p : [{ nombre: "Precio", valor: precio }];
}

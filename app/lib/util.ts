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
  if (falta < 0) return { ok: false, motivo: "Lo que entrega el cliente supera el total de la compra" };
  if (falta > 0) {
    calc.push({ medioId: resto.id, nombre: resto.nombre, pct: resto.ajustePct, monto: Math.round(falta * (1 + resto.ajustePct / 100)), valorLista: falta });
  }
  return { ok: true, pagos: calc, total: calc.reduce((s, p) => s + p.monto, 0) };
}

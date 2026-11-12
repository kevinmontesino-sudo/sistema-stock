import { pool } from "./db";
import { empresa } from "./empresa.config";
import { descripcionPromo, textoPromo, TOPE_PCT, type Promo } from "./promos";
import { ErrorNegocio } from "./repo";
import { NO_ANULADA } from "./util";

// Alta, listado y baja de promos. Lo usan la pantalla Oficina > Promos (administradores) y la API /api/promos (llave de alcance "promos").
const falla = (m: string): never => { throw new ErrorNegocio(m); };
const LOCALES = empresa.sucursales.map((s) => s.id);
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export type PromoFila = Promo & { descripcion: string; activa: boolean; estado: "vigente" | "programada" | "terminada" | "desactivada"; origen: string; creada: string; ventas: number; descontado: number };
export type PromoNueva = {
  nombre?: string; tipo: string; n?: number | null; m?: number | null; pct?: number | null; precio?: number | null;
  sucursales?: string[]; tipos?: string[]; desde: string; hasta: string;
  descuento_efectivo?: boolean; sin_cambio?: boolean;
};
const HOY_SQL = "(now() at time zone 'America/Argentina/Buenos_Aires')::date";
// "2026-02-30" pasa Date.parse: se compara contra la fecha que de verdad resulta.
const fechaValida = (d: string) => FECHA.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d;
// Una lista mal mandada (ej. "white" en vez de ["white"]) NO puede convertirse en "todos los locales".
function lista(v: unknown, campo: string): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) falla(`"${campo}" tiene que ser una lista, por ejemplo ["white"]`);
  return (v as unknown[]).map(String);
}

const hoyAR = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

export async function listarPromos(f: { soloVigentes?: boolean } = {}): Promise<PromoFila[]> {
  const r = await pool.query<Promo & { activa: boolean; origen: string; creada: Date; ventas: number; descontado: number; hoy: string }>(
    `select p.id::int as id, p.nombre, p.tipo, p.n, p.m, p.pct::float8 as pct, p.precio, p.tipos, p.sucursales, p.desde::text as desde, p.hasta::text as hasta,
       p.descuento_efectivo as "descuentoEfectivo", p.sin_cambio as "sinCambio",
       (select coalesce(array_agg(t.nombre order by t.nombre), '{}') from tipos t where t.codigo = any(p.tipos)) as categorias,
       p.activa, p.origen, p.creado_en as creada,
       (select count(*)::int from ventas v where v.promo_id = p.id and ${NO_ANULADA}) as ventas,
       (select coalesce(sum(v.descuento_promo), 0)::int from ventas v where v.promo_id = p.id and ${NO_ANULADA}) as descontado
     from promos p
     where ($1::boolean is not true or (p.activa and p.hasta >= (now() at time zone 'America/Argentina/Buenos_Aires')::date))
     order by (p.activa and p.hasta >= (now() at time zone 'America/Argentina/Buenos_Aires')::date) desc, p.desde desc, p.id desc limit 300`,
    [f.soloVigentes ?? false],
  );
  const hoy = hoyAR();
  return r.rows.map((p) => ({
    ...p, creada: new Date(p.creada).toISOString(), descripcion: descripcionPromo(p),
    estado: !p.activa ? "desactivada" : p.hasta < hoy ? "terminada" : p.desde > hoy ? "programada" : "vigente",
  }));
}

export async function crearPromo(a: PromoNueva, quien: { usuarioId: number | null; origen: string }) {
  const tipo = a.tipo === "nxm" || a.tipo === "porcentaje" || a.tipo === "precio" ? a.tipo
    : falla('El tipo tiene que ser "nxm" (ej. 3x2), "porcentaje" o "precio" (cada prenda a $X)');
  let n: number | null = null, m: number | null = null, pct: number | null = null, precio: number | null = null;
  if (tipo === "nxm") {
    n = Number(a.n); m = Number(a.m);
    if (!Number.isInteger(n) || !Number.isInteger(m) || n < 2 || n > 10 || m < 1 || m >= n) falla("Para una promo NxM: n entre 2 y 10 y m menor que n (ej. 3x2: n=3, m=2)");
  } else if (tipo === "porcentaje") {
    pct = Number(a.pct);
    if (!Number.isFinite(pct) || pct <= 0 || pct > TOPE_PCT || Math.round(pct * 2) !== pct * 2) falla(`El porcentaje tiene que ser de 0,5 a ${TOPE_PCT}`);
  } else {
    precio = Number(a.precio);
    if (!Number.isInteger(precio) || precio <= 0 || precio >= 10_000_000) falla("Poné el precio por prenda en pesos, sin centavos (ej. 4500)");
    if (a.n !== undefined && a.n !== null && Number(a.n) > 1) {
      n = Number(a.n);
      if (!Number.isInteger(n) || n > 100) falla("El mínimo de prendas tiene que ser de 2 a 100 (ej. 12 para la docena)");
    }
  }
  // Por defecto: el efectivo corre encima de NxM y porcentaje; en "precio" (ferias, mayorista) no.
  const descuentoEfectivo = typeof a.descuento_efectivo === "boolean" ? a.descuento_efectivo : tipo !== "precio";
  const sinCambio = a.sin_cambio === true;
  const sucursales = [...new Set(lista(a.sucursales, "sucursales"))];
  for (const s of sucursales) if (!LOCALES.includes(s)) falla(`Sucursal inexistente: ${s}. Opciones: ${LOCALES.join(", ")}`);
  if (sucursales.length === LOCALES.length) sucursales.length = 0; // todas = vacio
  const tiposPedidos = [...new Set(lista(a.tipos, "tipos").map((t) => t.trim().toUpperCase()).filter(Boolean))];
  if (tiposPedidos.length) {
    const ok = await pool.query<{ codigo: string }>("select codigo from tipos where codigo = any($1)", [tiposPedidos]);
    const faltan = tiposPedidos.filter((t) => !ok.rows.some((x) => x.codigo === t));
    if (faltan.length) falla(`Categoría inexistente: ${faltan.join(", ")}`);
  }
  const desde = String(a.desde ?? ""), hasta = String(a.hasta ?? "");
  if (!fechaValida(desde) || !fechaValida(hasta)) falla("Fechas inválidas: usá AAAA-MM-DD (y que la fecha exista)");
  if (hasta < desde) falla("La fecha de fin es anterior a la de inicio");
  if (hasta < hoyAR()) falla("Esa promo ya terminó: la fecha de fin es anterior a hoy");
  if ((Date.parse(hasta) - Date.parse(desde)) / 86_400_000 > 92) falla("Una promo puede durar hasta 3 meses");
  const nombre = (String(a.nombre ?? "").trim().replace(/\s+/g, " ") || textoPromo({ tipo, n, m, pct, precio })).slice(0, 60);
  if (nombre.length < 2) falla("Ponele un nombre a la promo");
  const vigentes = await pool.query<{ n: number }>(`select count(*)::int as n from promos where activa and hasta >= ${HOY_SQL}`);
  if (vigentes.rows[0].n >= 30) falla("Hay demasiadas promos activas: desactivá alguna antes de crear otra");
  const r = await pool.query<{ id: number }>(
    `insert into promos (nombre, tipo, n, m, pct, precio, sucursales, tipos, desde, hasta, origen, creado_por, descuento_efectivo, sin_cambio)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id::int as id`,
    [nombre, tipo, n, m, pct, precio, sucursales, tiposPedidos, desde, hasta, quien.origen.slice(0, 80), quien.usuarioId, descuentoEfectivo, sinCambio],
  );
  return (await listarPromos()).find((p) => p.id === r.rows[0].id)!;
}

export async function desactivarPromo(id: number) {
  const r = await pool.query<{ nombre: string }>("update promos set activa = false where id = $1 and activa returning nombre", [Number(id)]);
  if (!r.rows[0]) falla("No existe esa promo o ya estaba desactivada");
  return { id: Number(id), nombre: r.rows[0].nombre };
}

// Descuentos especiales hechos en las cajas (para que la oficina los vea).
export async function descuentosEspeciales(limite = 100) {
  const r = await pool.query<{ codigo: string; fecha: Date; sucursal: string; usuario: string | null; pct: number; descuento: number; total: number; motivo: string; autorizo: string }>(
    `select v.codigo, v.creado_en as fecha, v.sucursal_id as sucursal, u.nombre as usuario, v.especial_pct::float8 as pct,
       v.descuento_promo as descuento, v.total, v.especial_motivo as motivo, v.especial_autorizo as autorizo
     from ventas v left join usuarios u on u.id = v.usuario_id
     where v.especial_pct is not null and ${NO_ANULADA} order by v.creado_en desc limit $1`,
    [Math.min(Math.max(1, limite), 500)],
  );
  return r.rows.map((x) => ({ ...x, fecha: new Date(x.fecha).toISOString() }));
}

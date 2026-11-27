import { pool } from "./db";
import { empresa } from "./empresa.config";
import { ErrorNegocio } from "./repo";
import { NO_ANULADA } from "./util";

// Comisiones de los vendedores. Semana = domingo a sabado: cierra el sabado (al cierre de caja).
// Cada vendedor cobra comision.pct de lo que vendio en la semana; el que mas vendio de SU sucursal cobra comision.pctGanador en lugar de ese %.
// Base = lo realmente cobrado (ventas.total) sin ventas anuladas (ni cortesias, que no se cobran), menos las notas de credito (devoluciones)
// emitidas esa semana sobre ventas de ese vendedor. Los empates ganan los dos. Las ventas sin vendedor no comisionan.
const TZ = "America/Argentina/Buenos_Aires";
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DIAS = 120;

export type FilaComision = {
  vendedorId: number; nombre: string; sucursal: string; ventas: number; vendido: number; devuelto: number; neto: number;
  pct: number; comision: number; ganador: boolean;
};
export type SemanaComision = { desde: string; hasta: string; estado: "cerrada" | "cierra_hoy" | "en_curso"; grupos: { sucursal: string; vendedores: FilaComision[] }[]; totalVendido: number; totalComision: number };
export type ResultadoComisiones = {
  parametros: { desde: string; hasta: string; ganador: "sucursal" | "total"; pct: number; pctGanador: number };
  semanas: SemanaComision[];
  porVendedor: { vendedorId: number; nombre: string; sucursal: string; neto: number; comision: number; semanasGanadas: number }[];
};

const sumar = (f: string, n: number) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const redondear = (n: number) => Math.round(n);

export async function comisiones(raw: { desde?: string | null; hasta?: string | null; ganador?: string | null }): Promise<ResultadoComisiones> {
  const hoy = (await pool.query<{ hoy: string }>(`select (now() at time zone '${TZ}')::date::text as hoy`)).rows[0].hoy;
  const ganador = raw.ganador === "total" ? "total" : raw.ganador && raw.ganador !== "sucursal" ? null : "sucursal";
  if (!ganador) throw new ErrorNegocio("ganador tiene que ser sucursal o total.");
  const hasta0 = raw.hasta?.trim() || hoy;
  const desde0 = raw.desde?.trim() || sumar(hasta0, -27);
  if (!FECHA.test(desde0) || !FECHA.test(hasta0) || Number.isNaN(Date.parse(desde0)) || Number.isNaN(Date.parse(hasta0))) throw new ErrorNegocio("Las fechas tienen que tener el formato AAAA-MM-DD.");
  if (desde0 > hasta0) throw new ErrorNegocio("La fecha 'desde' no puede ser posterior a 'hasta'.");
  if ((Date.parse(hasta0) - Date.parse(desde0)) / 86_400_000 > MAX_DIAS) throw new ErrorNegocio(`El rango no puede superar ${MAX_DIAS} días.`);
  // Se completan las semanas enteras (domingo a sabado) para que el 1,5% se decida con la semana completa.
  const r = await pool.query<{ d: string; h: string }>(
    `select (date_trunc('week', $1::date + 1)::date - 1)::text as d, (date_trunc('week', $2::date + 1)::date + 5)::text as h`, [desde0, hasta0],
  );
  const desde = r.rows[0].d;
  const hasta = r.rows[0].h;
  const inicioSemana = `(date_trunc('week', (X at time zone '${TZ}')::date + 1)::date - 1)`;
  const rango = (col: string) => `${col} >= ($1::date)::timestamp at time zone '${TZ}' and ${col} < ($2::date + 1)::timestamp at time zone '${TZ}'`;

  const ventas = await pool.query<{ semana: string; vid: number; nombre: string; suc: string; n: number; vendido: number }>(
    `select ${inicioSemana.replace("X", "v.creado_en")}::text as semana, v.vendedor_id::int as vid, max(v.vendedor_nombre) as nombre, max(v.vendedor_sucursal_id) as suc,
       count(*)::int as n, sum(v.total)::float8 as vendido
     from ventas v where v.vendedor_id is not null and v.cliente_mayorista_id is null and ${NO_ANULADA} and ${rango("v.creado_en")} group by 1, 2`,
    [desde, hasta],
  );
  const notas = await pool.query<{ semana: string; vid: number; nombre: string; suc: string; devuelto: number }>(
    `select ${inicioSemana.replace("X", "n.creado_en")}::text as semana, v.vendedor_id::int as vid, max(v.vendedor_nombre) as nombre, max(v.vendedor_sucursal_id) as suc,
       sum(n.monto_inicial)::float8 as devuelto
     from notas_credito n join ventas v on v.id = n.venta_id
     where v.vendedor_id is not null and ${rango("n.creado_en")} group by 1, 2`,
    [desde, hasta],
  );

  type Acum = { vid: number; nombre: string; suc: string; n: number; vendido: number; devuelto: number };
  const porSemana = new Map<string, Map<number, Acum>>();
  const tomar = (semana: string, vid: number, nombre: string, suc: string) => {
    if (!porSemana.has(semana)) porSemana.set(semana, new Map());
    const m = porSemana.get(semana)!;
    if (!m.has(vid)) m.set(vid, { vid, nombre, suc, n: 0, vendido: 0, devuelto: 0 });
    return m.get(vid)!;
  };
  for (const x of ventas.rows) { const a = tomar(x.semana, x.vid, x.nombre, x.suc); a.n += x.n; a.vendido += x.vendido; }
  for (const x of notas.rows) { const a = tomar(x.semana, x.vid, x.nombre, x.suc); a.devuelto += x.devuelto; }

  const { pct, pctGanador } = empresa.comision;
  const semanas: SemanaComision[] = [];
  const total = new Map<number, { vendedorId: number; nombre: string; sucursal: string; neto: number; comision: number; semanasGanadas: number }>();
  for (let ini = desde; ini <= hasta; ini = sumar(ini, 7)) {
    const sab = sumar(ini, 6);
    const acum = [...(porSemana.get(ini)?.values() ?? [])].map((a) => ({ ...a, neto: a.vendido - a.devuelto }));
    const grupos = new Map<string, typeof acum>();
    for (const a of acum) { const k = ganador === "sucursal" ? a.suc : "todas"; grupos.set(k, [...(grupos.get(k) ?? []), a]); }
    const maxPor = new Map<string, number>();
    for (const [k, l] of grupos) maxPor.set(k, Math.max(...l.map((a) => a.neto)));
    const filas = new Map<string, FilaComision[]>();
    for (const a of acum) {
      const k = ganador === "sucursal" ? a.suc : "todas";
      const gana = a.neto > 0 && a.neto === maxPor.get(k);
      const p = gana ? pctGanador : pct;
      const fila: FilaComision = { vendedorId: a.vid, nombre: a.nombre, sucursal: a.suc, ventas: a.n, vendido: redondear(a.vendido), devuelto: redondear(a.devuelto), neto: redondear(a.neto), pct: p, comision: Math.max(0, redondear(a.neto * p / 100)), ganador: gana };
      filas.set(a.suc, [...(filas.get(a.suc) ?? []), fila]);
      const t = total.get(a.vid) ?? { vendedorId: a.vid, nombre: a.nombre, sucursal: a.suc, neto: 0, comision: 0, semanasGanadas: 0 };
      t.neto += fila.neto; t.comision += fila.comision; t.semanasGanadas += gana ? 1 : 0;
      total.set(a.vid, t);
    }
    const g = [...filas.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([sucursal, vendedores]) => ({ sucursal, vendedores: vendedores.sort((x, y) => y.neto - x.neto) }));
    semanas.push({
      desde: ini, hasta: sab, estado: hoy > sab ? "cerrada" : hoy === sab ? "cierra_hoy" : "en_curso", grupos: g,
      totalVendido: g.reduce((s, x) => s + x.vendedores.reduce((q, f) => q + f.neto, 0), 0), totalComision: g.reduce((s, x) => s + x.vendedores.reduce((q, f) => q + f.comision, 0), 0),
    });
  }
  return {
    parametros: { desde, hasta, ganador, pct, pctGanador },
    semanas: semanas.reverse(),
    porVendedor: [...total.values()].sort((a, b) => a.sucursal.localeCompare(b.sucursal) || b.neto - a.neto),
  };
}

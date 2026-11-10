import { empresa } from "./empresa.config";
import { pool } from "./db";
import { ErrorNegocio } from "./repo";
import { nombreSucursal } from "./util";

// Cierre de caja diario por local y informe de control. Todos los dias son de Argentina.
const TZ = "America/Argentina/Buenos_Aires";
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const rango = (col: string, n = 2) => `${col} >= ($${n}::date)::timestamp at time zone '${TZ}' and ${col} < ($${n}::date + 1)::timestamp at time zone '${TZ}'`;

export type CierreCaja = {
  id: number; sucursal: string; dia: string; creado: string; cerradoPor: string;
  fondoInicial: number; retiros: number; retirosMotivo: string | null; ventas: number; unidades: number;
  esperado: Record<string, number>; contado: Record<string, number>;
  efectivoEsperado: number; efectivoContado: number; diferencia: number;
  notasEmitidas: number; notasMonto: number; observaciones: string | null;
};
export type MedioDia = { id: string; nombre: string; ventas: number; monto: number };
export type ResumenDia = {
  sucursal: string; dia: string; ventas: number; unidades: number; totalCobrado: number; medios: MedioDia[];
  pagadoConNotas: number; notasEmitidas: number; notasMonto: number;
  cierre: CierreCaja | null; ventasDespuesDelCierre: number;
};

export async function hoyAR() {
  return (await pool.query<{ hoy: string }>(`select (now() at time zone '${TZ}')::date::text as hoy`)).rows[0].hoy;
}
async function diaOk(dia: string) {
  if (!FECHA.test(dia) || Number.isNaN(Date.parse(dia))) throw new ErrorNegocio("Fecha inválida.");
  if (dia > (await hoyAR())) throw new ErrorNegocio("No se puede cerrar la caja de un día que todavía no llegó.");
}
const sucOk = (s: string) => { if (!empresa.sucursales.some((x) => x.id === s)) throw new ErrorNegocio("Sucursal inexistente."); };

type FilaCierre = {
  id: number; sucursal_id: string; dia: string; creado_en: Date; cerrado_por: string; fondo_inicial: number; retiros: number; retiros_motivo: string | null;
  ventas: number; unidades: number; esperado: Record<string, number>; contado: Record<string, number>; efectivo_esperado: number; efectivo_contado: number;
  diferencia: number; notas_emitidas: number; notas_monto: number; observaciones: string | null;
};
const COLS = `id::int, sucursal_id, dia::text, creado_en, cerrado_por, fondo_inicial, retiros, retiros_motivo, ventas, unidades, esperado, contado,
  efectivo_esperado, efectivo_contado, diferencia, notas_emitidas, notas_monto, observaciones`;
const aCierre = (c: FilaCierre): CierreCaja => ({
  id: c.id, sucursal: c.sucursal_id, dia: c.dia, creado: c.creado_en.toISOString(), cerradoPor: c.cerrado_por, fondoInicial: c.fondo_inicial,
  retiros: c.retiros, retirosMotivo: c.retiros_motivo, ventas: c.ventas, unidades: c.unidades, esperado: c.esperado, contado: c.contado,
  efectivoEsperado: c.efectivo_esperado, efectivoContado: c.efectivo_contado, diferencia: c.diferencia, notasEmitidas: c.notas_emitidas,
  notasMonto: c.notas_monto, observaciones: c.observaciones,
});

// Lo que el sistema dice que paso en un local ese dia, mas el cierre si ya se hizo.
export async function resumenDia(sucursal: string, dia: string): Promise<ResumenDia> {
  sucOk(sucursal);
  if (!FECHA.test(dia)) throw new ErrorNegocio("Fecha inválida.");
  const v = await pool.query<{ ventas: number; unidades: number }>(
    `select count(*)::int as ventas, coalesce(sum((select sum(cantidad) from venta_items vi where vi.venta_id = v.id)), 0)::int as unidades
     from ventas v where v.sucursal_id = $1 and ${rango("v.creado_en")}`, [sucursal, dia]);
  const m = await pool.query<MedioDia>(
    `select pg.medio_pago_id as id, m.nombre, count(distinct pg.venta_id)::int as ventas, sum(pg.monto)::float8 as monto
     from venta_pagos pg join ventas v on v.id = pg.venta_id join medios_pago m on m.id = pg.medio_pago_id
     where v.sucursal_id = $1 and ${rango("v.creado_en")} and pg.nota_credito_id is null group by 1, 2 order by m.nombre`, [sucursal, dia]);
  const n = await pool.query<{ monto: number }>(
    `select coalesce(sum(pg.monto), 0)::float8 as monto from venta_pagos pg join ventas v on v.id = pg.venta_id
     where v.sucursal_id = $1 and ${rango("v.creado_en")} and pg.nota_credito_id is not null`, [sucursal, dia]);
  const e = await pool.query<{ n: number; monto: number }>(
    `select count(*)::int as n, coalesce(sum(monto_inicial), 0)::int as monto from notas_credito where sucursal_id = $1 and ${rango("creado_en")}`, [sucursal, dia]);
  const c = await pool.query<FilaCierre>(`select ${COLS} from cierres_caja where sucursal_id = $1 and dia = $2::date`, [sucursal, dia]);
  const cierre = c.rows[0] ? aCierre(c.rows[0]) : null;
  const despues = cierre
    ? (await pool.query<{ n: number }>(`select count(*)::int as n from ventas v where v.sucursal_id = $1 and ${rango("v.creado_en")} and v.creado_en > $3`, [sucursal, dia, cierre.creado])).rows[0].n
    : 0;
  return {
    sucursal, dia, ventas: v.rows[0].ventas, unidades: v.rows[0].unidades, medios: m.rows, totalCobrado: m.rows.reduce((s, x) => s + x.monto, 0),
    pagadoConNotas: n.rows[0].monto, notasEmitidas: e.rows[0].n, notasMonto: e.rows[0].monto, cierre, ventasDespuesDelCierre: despues,
  };
}

export type DatosCierre = { fondoInicial: number; retiros: number; retirosMotivo: string; efectivoContado: number; otrosContados: Record<string, number>; observaciones: string };
const monto = (v: unknown, que: string, obligatorio = true) => {
  if (v === null || v === undefined || v === "") { if (obligatorio) throw new ErrorNegocio(`Falta ${que}.`); return 0; }
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100_000_000) throw new ErrorNegocio(`${que[0].toUpperCase()}${que.slice(1)} no es válido.`);
  return Math.round(n);
};

export async function cerrarCaja(sucursal: string, dia: string, d: DatosCierre, usuario: { id: number; nombre: string }) {
  sucOk(sucursal);
  await diaOk(dia);
  const fondo = monto(d.fondoInicial, "el efectivo con el que abrió la caja", false);
  const retiros = monto(d.retiros, "el monto retirado", false);
  const contado = monto(d.efectivoContado, "el efectivo contado");
  const motivo = (d.retirosMotivo ?? "").trim().slice(0, 200);
  if (retiros > 0 && !motivo) throw new ErrorNegocio("Si retiraste plata de la caja, escribí para qué (gasto, depósito en banco, etc.).");
  const r = await resumenDia(sucursal, dia);
  if (r.cierre) throw new ErrorNegocio(`La caja de ${nombreSucursal(sucursal)} del ${dia} ya fue cerrada por ${r.cierre.cerradoPor}.`);
  const esperado: Record<string, number> = Object.fromEntries(r.medios.map((m) => [m.id, m.monto]));
  const otros: Record<string, number> = {};
  for (const [id, v] of Object.entries(d.otrosContados ?? {})) {
    if (id === "efectivo" || !(id in esperado) || v === null || (v as unknown) === "") continue;
    otros[id] = monto(v, `lo contado en ${id}`);
  }
  const efectivoEsperado = fondo + (esperado.efectivo ?? 0) - retiros;
  const diferencia = contado - efectivoEsperado;
  try {
    const x = await pool.query<FilaCierre>(
      `insert into cierres_caja (sucursal_id, dia, usuario_id, cerrado_por, fondo_inicial, retiros, retiros_motivo, ventas, unidades, esperado, contado,
         efectivo_esperado, efectivo_contado, diferencia, notas_emitidas, notas_monto, observaciones)
       values ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) returning ${COLS}`,
      [sucursal, dia, usuario.id, usuario.nombre, fondo, retiros, motivo || null, r.ventas, r.unidades, JSON.stringify(esperado), JSON.stringify({ efectivo: contado, ...otros }),
        efectivoEsperado, contado, diferencia, r.notasEmitidas, r.notasMonto, (d.observaciones ?? "").trim().slice(0, 500) || null],
    );
    return aCierre(x.rows[0]);
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new ErrorNegocio("Esa caja ya fue cerrada.");
    throw e;
  }
}

export async function cierresEntre(desde: string, hasta: string, sucursal: string | null) {
  if (!FECHA.test(desde) || !FECHA.test(hasta)) throw new ErrorNegocio("Fechas inválidas.");
  const r = await pool.query<FilaCierre>(
    `select ${COLS} from cierres_caja where dia between $1::date and $2::date and ($3::text is null or sucursal_id = $3) order by dia, sucursal_id limit 1000`,
    [desde, hasta, sucursal]);
  return r.rows.map(aCierre);
}

// ---- Informe de control del dia (para imprimir en A4 y para la API) ----
export async function controlDiario(dia: string, sucursal: string | null = null) {
  if (!FECHA.test(dia) || Number.isNaN(Date.parse(dia))) throw new ErrorNegocio("Fecha inválida.");
  if (sucursal) sucOk(sucursal);
  const hoy = await hoyAR();
  const ids = empresa.sucursales.map((s) => s.id).filter((s) => !sucursal || s === sucursal);
  const locales = await Promise.all(ids.map((id) => resumenDia(id, dia)));
  const esp = await pool.query<{ sucursal: string; codigo: string; hora: Date; pct: number; motivo: string | null; autorizo: string | null; descuento: number; total: number; vendedor: string | null }>(
    `select v.sucursal_id as sucursal, v.codigo, v.creado_en as hora, v.especial_pct::float8 as pct, v.especial_motivo as motivo, v.especial_autorizo as autorizo,
       v.descuento_promo as descuento, v.total, u.nombre as vendedor
     from ventas v left join usuarios u on u.id = v.usuario_id
     where v.especial_pct is not null and ${rango("v.creado_en", 1)} and ($2::text is null or v.sucursal_id = $2) order by v.creado_en`, [dia, sucursal]);
  const promos = await pool.query<{ sucursal: string; ahorro: number; ventas: number }>(
    `select v.sucursal_id as sucursal, coalesce(sum(v.descuento_promo), 0)::float8 as ahorro, count(*)::int as ventas from ventas v
     where v.especial_pct is null and v.descuento_promo > 0 and ${rango("v.creado_en", 1)} and ($2::text is null or v.sucursal_id = $2) group by 1`, [dia, sucursal]);
  const ajustes = await pool.query<{ hora: Date; sku: string; nombre: string; cantidad: number; sucursal: string | null; motivo: string | null; usuario: string | null }>(
    `select m.creado_en as hora, m.sku, p.nombre, m.cantidad, coalesce(m.desde, m.hasta) as sucursal, m.motivo, u.nombre as usuario
     from movimientos m join productos p on p.sku = m.sku left join usuarios u on u.id = m.usuario_id
     where m.tipo = 'ajuste' and ${rango("m.creado_en", 1)} and ($2::text is null or coalesce(m.desde, m.hasta) = $2) order by m.creado_en`, [dia, sucursal]);
  const camino = await pool.query<{ destino: string; envios: number; unidades: number; dias: number }>(
    `select hasta as destino, count(*)::int as envios, sum(cantidad - cantidad_recibida)::int as unidades,
       floor(extract(epoch from now() - min(creado_en)) / 86400)::int as dias
     from traslados where estado = 'en_camino' and ($1::text is null or hasta = $1) group by hasta order by hasta`, [sucursal]);

  const alertas: string[] = [];
  for (const l of locales) {
    const n = nombreSucursal(l.sucursal);
    if (l.ventas > 0 && !l.cierre) alertas.push(dia < hoy ? `${n}: tuvo ${l.ventas} ventas y NO cerró la caja.` : `${n}: todavía no cerró la caja de hoy.`);
    if (l.cierre && l.cierre.diferencia !== 0) alertas.push(`${n}: diferencia de efectivo ${l.cierre.diferencia > 0 ? "a favor" : "faltante"} de $${Math.abs(l.cierre.diferencia).toLocaleString("es-AR")}.`);
    if (l.ventasDespuesDelCierre > 0) alertas.push(`${n}: ${l.ventasDespuesDelCierre} venta(s) hechas DESPUÉS de cerrar la caja.`);
  }
  for (const e of esp.rows) alertas.push(`${nombreSucursal(e.sucursal)}: descuento especial ${e.pct}% en ${e.codigo} (${e.motivo ?? "sin motivo"}, autorizó ${e.autorizo ?? "?"}).`);
  for (const a of ajustes.rows) alertas.push(`Ajuste de stock: ${a.sku} ${a.nombre} (${a.cantidad} u.) en ${a.sucursal ? nombreSucursal(a.sucursal) : "?"} — ${a.motivo ?? "sin motivo"}.`);
  for (const c of camino.rows.filter((x) => x.dias >= 2)) alertas.push(`${nombreSucursal(c.destino)}: ${c.unidades} prendas enviadas hace ${c.dias} días siguen sin recibirse.`);

  const total = (f: (l: ResumenDia) => number) => locales.reduce((s, l) => s + f(l), 0);
  return {
    dia, generado: new Date().toISOString(),
    total: { ventas: total((l) => l.ventas), unidades: total((l) => l.unidades), cobrado: total((l) => l.totalCobrado), pagadoConNotas: total((l) => l.pagadoConNotas), notasEmitidas: total((l) => l.notasEmitidas), notasMonto: total((l) => l.notasMonto), diferenciaEfectivo: locales.reduce((s, l) => s + (l.cierre?.diferencia ?? 0), 0) },
    locales: locales.map((l) => ({ ...l, ahorroPromos: promos.rows.find((p) => p.sucursal === l.sucursal)?.ahorro ?? 0, ventasConPromo: promos.rows.find((p) => p.sucursal === l.sucursal)?.ventas ?? 0 })),
    descuentosEspeciales: esp.rows.map((e) => ({ sucursal: e.sucursal, ticket: e.codigo, hora: e.hora.toISOString(), pct: e.pct, motivo: e.motivo, autorizo: e.autorizo, descuento: e.descuento, total: e.total, cajero: e.vendedor })),
    ajustesDeStock: ajustes.rows.map((a) => ({ hora: a.hora.toISOString(), sku: a.sku, prenda: a.nombre, cantidad: a.cantidad, sucursal: a.sucursal, motivo: a.motivo, usuario: a.usuario })),
    enviosEnCamino: camino.rows.map((c) => ({ destino: c.destino, envios: c.envios, unidades: c.unidades, diasElMasViejo: c.dias })),
    alertas,
  };
}
export type Control = Awaited<ReturnType<typeof controlDiario>>;

import { empresa } from "./empresa.config";
import { pool } from "./db";
import { ErrorNegocio } from "./repo";
import { nombreSucursal } from "./util";

// Informes de SOLO LECTURA (solo SELECT). Los usan la pantalla de administracion y la API de informes, asi los numeros coinciden.
// Todas las fechas son de Argentina (America/Argentina/Buenos_Aires) y el rango "desde-hasta" incluye ambos dias.
const TZ = "America/Argentina/Buenos_Aires";
const MAX_DIAS = 400;

export type Agrupar = "dia" | "semana" | "mes";
export type ParamsInforme = { desde: string; hasta: string; sucursal: string | null; agrupar: Agrupar; limite: number };

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const ahoraMs = (f: string) => Date.parse(`${f}T00:00:00Z`);
const sumarDias = (f: string, n: number) => new Date(ahoraMs(f) + n * 86_400_000).toISOString().slice(0, 10);

export async function hoyArgentina() {
  const r = await pool.query<{ hoy: string }>(`select (now() at time zone '${TZ}')::date::text as hoy`);
  return r.rows[0].hoy;
}

// Valida y completa los parametros (por defecto, los ultimos 30 dias de todas las sucursales). Nunca se arma SQL con texto del usuario.
export async function validarParams(raw: { desde?: unknown; hasta?: unknown; sucursal?: unknown; agrupar?: unknown; limite?: unknown }): Promise<ParamsInforme> {
  const txt = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const hoy = await hoyArgentina();
  const hasta = txt(raw.hasta) || hoy;
  const desde = txt(raw.desde) || sumarDias(hasta, -29);
  if (!FECHA.test(desde) || !FECHA.test(hasta) || Number.isNaN(ahoraMs(desde)) || Number.isNaN(ahoraMs(hasta))) throw new ErrorNegocio("Las fechas tienen que tener el formato AAAA-MM-DD.");
  if (desde > hasta) throw new ErrorNegocio("La fecha 'desde' no puede ser posterior a 'hasta'.");
  if ((ahoraMs(hasta) - ahoraMs(desde)) / 86_400_000 > MAX_DIAS) throw new ErrorNegocio(`El rango no puede superar ${MAX_DIAS} días.`);
  const suc = txt(raw.sucursal);
  if (suc && !empresa.sucursales.some((s) => s.id === suc)) throw new ErrorNegocio("Sucursal inexistente.");
  const agr = txt(raw.agrupar) || "dia";
  if (agr !== "dia" && agr !== "semana" && agr !== "mes") throw new ErrorNegocio("agrupar tiene que ser dia, semana o mes.");
  const lim = Math.floor(Number(raw.limite) || 20);
  return { desde, hasta, sucursal: suc || null, agrupar: agr, limite: Math.min(Math.max(lim, 1), 200) };
}

const rango = (col: string) => `${col} >= ($1::date)::timestamp at time zone '${TZ}' and ${col} < ($2::date + 1)::timestamp at time zone '${TZ}'`;
const filtroSuc = (col: string, n = 3) => `($${n}::text is null or ${col} = $${n})`;
const base = (p: ParamsInforme) => [p.desde, p.hasta, p.sucursal];

// ---- Resumen de ventas por sucursal ----
export async function resumen(p: ParamsInforme) {
  const ventas = await pool.query<{ sucursal: string; ventas: number; unidades: number; lista: number; total_pagado: number }>(
    `select v.sucursal_id as sucursal, count(*)::int as ventas, coalesce(sum(it.u), 0)::int as unidades,
       sum(v.subtotal_lista)::float8 as lista, sum(v.total)::float8 as total_pagado
     from ventas v left join (select venta_id, sum(cantidad) u from venta_items group by venta_id) it on it.venta_id = v.id
     where ${rango("v.creado_en")} and ${filtroSuc("v.sucursal_id")} group by v.sucursal_id order by v.sucursal_id`,
    base(p),
  );
  const medios = await pool.query<{ sucursal: string; medio: string; nombre: string; monto: number; ventas: number }>(
    `select v.sucursal_id as sucursal, pg.medio_pago_id as medio, m.nombre, sum(pg.monto)::float8 as monto, count(distinct pg.venta_id)::int as ventas
     from venta_pagos pg join ventas v on v.id = pg.venta_id join medios_pago m on m.id = pg.medio_pago_id
     where ${rango("v.creado_en")} and ${filtroSuc("v.sucursal_id")} group by 1, 2, 3 order by 1, 2`,
    base(p),
  );
  const filas = ventas.rows.map((v) => {
    const mios = medios.rows.filter((m) => m.sucursal === v.sucursal);
    const conNotas = mios.find((m) => m.medio === "nota_credito")?.monto ?? 0;
    const cobrado = mios.filter((m) => m.medio !== "nota_credito").reduce((s, m) => s + m.monto, 0);
    return {
      sucursal: v.sucursal, nombre: nombreSucursal(v.sucursal), ventas: v.ventas, unidades: v.unidades, lista: v.lista,
      totalPagado: v.total_pagado, cobradoEnCaja: cobrado, pagadoConNotas: conNotas,
      ticketPromedio: v.ventas ? Math.round(v.total_pagado / v.ventas) : 0, ajusteMediosDePago: v.total_pagado - v.lista,
      porMedio: mios.map((m) => ({ medio: m.medio, nombre: m.nombre, monto: m.monto, ventas: m.ventas })),
    };
  });
  const suma = (k: "ventas" | "unidades" | "lista" | "totalPagado" | "cobradoEnCaja" | "pagadoConNotas") => filas.reduce((s, f) => s + f[k], 0);
  const porMedioTotal = new Map<string, { medio: string; nombre: string; monto: number; ventas: number }>();
  for (const m of medios.rows) {
    const x = porMedioTotal.get(m.medio) ?? { medio: m.medio, nombre: m.nombre, monto: 0, ventas: 0 };
    x.monto += m.monto; x.ventas += m.ventas; porMedioTotal.set(m.medio, x);
  }
  return {
    porSucursal: filas,
    total: {
      ventas: suma("ventas"), unidades: suma("unidades"), lista: suma("lista"), totalPagado: suma("totalPagado"),
      cobradoEnCaja: suma("cobradoEnCaja"), pagadoConNotas: suma("pagadoConNotas"),
      ticketPromedio: suma("ventas") ? Math.round(suma("totalPagado") / suma("ventas")) : 0,
      porMedio: [...porMedioTotal.values()],
    },
  };
}

// ---- Evolucion por dia / semana / mes ----
export async function periodo(p: ParamsInforme) {
  const r = await pool.query<{ periodo: string; sucursal: string; ventas: number; unidades: number; lista: number; total_pagado: number }>(
    `select date_trunc($4::text, v.creado_en at time zone '${TZ}')::date::text as periodo, v.sucursal_id as sucursal, count(*)::int as ventas,
       coalesce(sum(it.u), 0)::int as unidades, sum(v.subtotal_lista)::float8 as lista, sum(v.total)::float8 as total_pagado
     from ventas v left join (select venta_id, sum(cantidad) u from venta_items group by venta_id) it on it.venta_id = v.id
     where ${rango("v.creado_en")} and ${filtroSuc("v.sucursal_id")} group by 1, 2 order by 1, 2`,
    [...base(p), p.agrupar === "dia" ? "day" : p.agrupar === "semana" ? "week" : "month"],
  );
  const porPeriodo = new Map<string, { periodo: string; ventas: number; unidades: number; lista: number; totalPagado: number; porSucursal: Record<string, number> }>();
  for (const x of r.rows) {
    const f = porPeriodo.get(x.periodo) ?? { periodo: x.periodo, ventas: 0, unidades: 0, lista: 0, totalPagado: 0, porSucursal: {} };
    f.ventas += x.ventas; f.unidades += x.unidades; f.lista += x.lista; f.totalPagado += x.total_pagado; f.porSucursal[x.sucursal] = x.total_pagado;
    porPeriodo.set(x.periodo, f);
  }
  return { agrupadoPor: p.agrupar, periodos: [...porPeriodo.values()] };
}

// ---- Prendas mas vendidas (netas = vendidas - devueltas) ----
export async function prendasMasVendidas(p: ParamsInforme) {
  const r = await pool.query<{ sku: string; nombre: string; vendidas: number; devueltas: number; importe_lista: number }>(
    `select vi.sku, max(vi.nombre) as nombre, sum(vi.cantidad)::int as vendidas, coalesce(sum(d.c), 0)::int as devueltas,
       sum(vi.cantidad * vi.precio_lista)::float8 as importe_lista
     from venta_items vi join ventas v on v.id = vi.venta_id
     left join (select venta_item_id, sum(cantidad) c from nota_credito_items group by venta_item_id) d on d.venta_item_id = vi.id
     where ${rango("v.creado_en")} and ${filtroSuc("v.sucursal_id")}
     group by vi.sku order by (sum(vi.cantidad) - coalesce(sum(d.c), 0)) desc, sum(vi.cantidad) desc, vi.sku limit $4`,
    [...base(p), p.limite],
  );
  const skus = r.rows.map((x) => x.sku);
  const por = skus.length
    ? await pool.query<{ sku: string; sucursal: string; u: number }>(
        `select vi.sku, v.sucursal_id as sucursal, sum(vi.cantidad)::int as u from venta_items vi join ventas v on v.id = vi.venta_id
         where ${rango("v.creado_en")} and ${filtroSuc("v.sucursal_id")} and vi.sku = any($4) group by 1, 2`,
        [...base(p), skus],
      )
    : { rows: [] as { sku: string; sucursal: string; u: number }[] };
  return {
    prendas: r.rows.map((x, i) => ({
      puesto: i + 1, sku: x.sku, nombre: x.nombre, vendidas: x.vendidas, devueltas: x.devueltas, netas: x.vendidas - x.devueltas,
      importeLista: x.importe_lista, porSucursal: Object.fromEntries(por.rows.filter((q) => q.sku === x.sku).map((q) => [q.sucursal, q.u])),
    })),
  };
}

// ---- Prendas con stock que menos rotan (incluye las que no se vendieron nada) ----
export async function prendasMenosVendidas(p: ParamsInforme) {
  const r = await pool.query<{ sku: string; nombre: string; precio: number; stock: number; vendidas: number; ultimo_ingreso: Date | null }>(
    `select p.sku, p.nombre, p.precio_lista as precio, coalesce(st.t, 0)::int as stock, coalesce(vv.u, 0)::int as vendidas,
       (select max(c.creado_en) from cargas c where c.sku = p.sku) as ultimo_ingreso
     from productos p
     left join (select sku, sum(cantidad) t from stock where ${filtroSuc("sucursal_id")} group by sku) st on st.sku = p.sku
     left join (select vi.sku, sum(vi.cantidad) u from venta_items vi join ventas v on v.id = vi.venta_id
                where ${rango("v.creado_en")} and ${filtroSuc("v.sucursal_id")} group by vi.sku) vv on vv.sku = p.sku
     where p.activo and coalesce(st.t, 0) > 0 order by coalesce(vv.u, 0) asc, st.t desc, p.sku limit $4`,
    [...base(p), p.limite],
  );
  return {
    prendas: r.rows.map((x) => ({
      sku: x.sku, nombre: x.nombre, precioLista: x.precio, stock: x.stock, vendidasEnElPeriodo: x.vendidas,
      valorStockALista: x.stock * x.precio, ultimoIngreso: x.ultimo_ingreso ? new Date(x.ultimo_ingreso).toISOString().slice(0, 10) : null,
    })),
  };
}

// ---- Notas de credito y devoluciones ----
export async function notasCredito(p: ParamsInforme) {
  const emitidas = await pool.query<{ codigo: string; creada: Date; sucursal: string; venta: number; monto: number; saldo: number; unidades: number; falladas: number; emitida_por: string | null }>(
    `select n.codigo, n.creado_en as creada, n.sucursal_id as sucursal, n.venta_id::int as venta, n.monto_inicial as monto, n.saldo,
       coalesce(it.u, 0)::int as unidades, coalesce(it.f, 0)::int as falladas, u.nombre as emitida_por
     from notas_credito n left join usuarios u on u.id = n.usuario_id
     left join (select nota_id, sum(cantidad) u, sum(falladas) f from nota_credito_items group by nota_id) it on it.nota_id = n.id
     where ${rango("n.creado_en")} and ${filtroSuc("n.sucursal_id")} order by n.creado_en desc limit 500`,
    base(p),
  );
  const usado = await pool.query<{ monto: number; ventas: number }>(
    `select coalesce(sum(pg.monto), 0)::float8 as monto, count(distinct pg.venta_id)::int as ventas
     from venta_pagos pg join ventas v on v.id = pg.venta_id
     where pg.nota_credito_id is not null and ${rango("v.creado_en")} and ${filtroSuc("v.sucursal_id")}`,
    base(p),
  );
  const pendiente = await pool.query<{ monto: number; notas: number }>(
    `select coalesce(sum(saldo), 0)::float8 as monto, count(*) filter (where saldo > 0)::int as notas from notas_credito where ${filtroSuc("sucursal_id", 1)}`,
    [p.sucursal],
  );
  const e = emitidas.rows;
  return {
    resumen: {
      emitidas: e.length, montoEmitido: e.reduce((s, n) => s + n.monto, 0), unidadesDevueltas: e.reduce((s, n) => s + n.unidades, 0),
      unidadesFalladas: e.reduce((s, n) => s + n.falladas, 0), usadoComoPagoEnElPeriodo: usado.rows[0].monto, ventasPagadasConNotas: usado.rows[0].ventas,
      saldoPendienteDeUsar: pendiente.rows[0].monto, notasConSaldo: pendiente.rows[0].notas,
    },
    notas: e.map((n) => ({
      codigo: n.codigo, fecha: new Date(n.creada).toISOString(), sucursal: n.sucursal, ventaOriginal: n.venta, monto: n.monto, saldo: n.saldo,
      unidades: n.unidades, falladas: n.falladas, emitidaPor: n.emitida_por,
    })),
  };
}

// ---- Stock actual valorizado a precio de lista ----
export async function stock(p: ParamsInforme) {
  const s = await pool.query<{ sucursal: string; unidades: number; modelos: number; valor: number }>(
    `select s.sucursal_id as sucursal, sum(s.cantidad)::int as unidades, count(*) filter (where s.cantidad > 0)::int as modelos,
       sum(s.cantidad * p.precio_lista)::float8 as valor
     from stock s join productos p on p.sku = s.sku where p.activo and s.cantidad > 0 and ${filtroSuc("s.sucursal_id", 1)} group by 1 order by 1`,
    [p.sucursal],
  );
  const c = await pool.query<{ sucursal: string; unidades: number; valor: number }>(
    `select t.hasta as sucursal, sum(t.cantidad - t.cantidad_recibida)::int as unidades, sum((t.cantidad - t.cantidad_recibida) * p.precio_lista)::float8 as valor
     from traslados t join productos p on p.sku = t.sku where t.estado = 'en_camino' and ${filtroSuc("t.hasta", 1)} group by 1 order by 1`,
    [p.sucursal],
  );
  return {
    nota: "Es el stock de HOY (no depende del rango de fechas). Valorizado a precio de lista.",
    porSucursal: s.rows.map((x) => ({ sucursal: x.sucursal, nombre: nombreSucursal(x.sucursal), unidades: x.unidades, modelos: x.modelos, valorALista: x.valor })),
    totalUnidades: s.rows.reduce((t, x) => t + x.unidades, 0), totalValorALista: s.rows.reduce((t, x) => t + x.valor, 0),
    enCaminoSinRecibir: c.rows.map((x) => ({ destino: x.sucursal, nombre: nombreSucursal(x.sucursal), unidades: x.unidades, valorALista: x.valor })),
  };
}

// ---- Horarios: en que dias y horas se vende mas ----
export async function horarios(p: ParamsInforme) {
  const r = await pool.query<{ dia: number; hora: number; ventas: number; total: number }>(
    `select extract(isodow from v.creado_en at time zone '${TZ}')::int as dia, extract(hour from v.creado_en at time zone '${TZ}')::int as hora,
       count(*)::int as ventas, sum(v.total)::float8 as total
     from ventas v where ${rango("v.creado_en")} and ${filtroSuc("v.sucursal_id")} group by 1, 2 order by 1, 2`,
    base(p),
  );
  const dias = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
  const porDia = new Map<number, { dia: string; ventas: number; total: number }>();
  const porHora = new Map<number, { hora: number; ventas: number; total: number }>();
  for (const x of r.rows) {
    const d = porDia.get(x.dia) ?? { dia: dias[x.dia], ventas: 0, total: 0 }; d.ventas += x.ventas; d.total += x.total; porDia.set(x.dia, d);
    const h = porHora.get(x.hora) ?? { hora: x.hora, ventas: 0, total: 0 }; h.ventas += x.ventas; h.total += x.total; porHora.set(x.hora, h);
  }
  return { porDiaDeLaSemana: [...porDia.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v), porHora: [...porHora.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v) };
}

// ---- Ingresos de mercaderia y envios a locales ----
export async function ingresos(p: ParamsInforme) {
  const cargas = await pool.query<{ dia: string; unidades: number; modelos: number }>(
    `select (c.creado_en at time zone '${TZ}')::date::text as dia, sum(c.cantidad)::int as unidades, count(distinct c.sku)::int as modelos
     from cargas c where ${rango("c.creado_en")} group by 1 order by 1`,
    [p.desde, p.hasta],
  );
  const envios = await pool.query<{ destino: string; enviadas: number; recibidas: number }>(
    `select t.hasta as destino, sum(t.cantidad)::int as enviadas, sum(t.cantidad_recibida)::int as recibidas
     from traslados t where ${rango("t.creado_en")} and t.estado <> 'devuelto' and ${filtroSuc("t.hasta")} group by 1 order by 1`,
    base(p),
  );
  return {
    cargasEnElDeposito: cargas.rows, totalCargado: cargas.rows.reduce((s, x) => s + x.unidades, 0),
    enviosPorDestino: envios.rows.map((x) => ({ destino: x.destino, nombre: nombreSucursal(x.destino), enviadas: x.enviadas, recibidas: x.recibidas, sinRecibir: x.enviadas - x.recibidas })),
  };
}

export const DEFINICIONES = {
  lista: "Valor de las prendas a precio de lista (= precio con transferencia).",
  totalPagado: "Lo que efectivamente pagaron los clientes: lista con el descuento o recargo de cada medio de pago (efectivo -20%, tarjeta +20%). Incluye lo pagado con notas de credito.",
  cobradoEnCaja: "Plata que entro: pagos en transferencia, efectivo y tarjeta (sin las notas de credito).",
  pagadoConNotas: "Parte de las compras pagada con notas de credito (no es plata nueva).",
  ajusteMediosDePago: "totalPagado - lista: negativo = descuentos por efectivo superan recargos.",
  netas: "Unidades vendidas menos devueltas (las devueltas con nota de credito de ventas del mismo periodo).",
  fechas: "Dia calendario de Argentina (America/Argentina/Buenos_Aires); el rango incluye 'desde' y 'hasta'.",
} as const;

export type TipoInforme = "resumen" | "periodo" | "prendas_mas_vendidas" | "prendas_menos_vendidas" | "notas_credito" | "stock" | "horarios" | "ingresos" | "panel";
export const TIPOS: Record<Exclude<TipoInforme, "panel">, { descripcion: string; usaFechas: boolean }> = {
  resumen: { descripcion: "Ventas, unidades, total pagado, cobrado en caja, ticket promedio y medios de pago, por sucursal y total.", usaFechas: true },
  periodo: { descripcion: "Evolucion de las ventas por dia, semana o mes (parametro agrupar), por sucursal.", usaFechas: true },
  prendas_mas_vendidas: { descripcion: "Ranking de prendas mas vendidas (vendidas, devueltas, netas, importe a lista y desglose por sucursal). Parametro limite.", usaFechas: true },
  prendas_menos_vendidas: { descripcion: "Prendas con stock que menos se vendieron en el periodo (rotacion), con stock y ultimo ingreso. Parametro limite.", usaFechas: true },
  notas_credito: { descripcion: "Notas de credito emitidas, usadas como pago, saldo pendiente, unidades devueltas y falladas.", usaFechas: true },
  stock: { descripcion: "Stock actual por sucursal valorizado a lista, y lo que esta en camino sin recibir.", usaFechas: false },
  horarios: { descripcion: "Ventas por dia de la semana y por hora.", usaFechas: true },
  ingresos: { descripcion: "Mercaderia cargada en el deposito y enviada a cada local en el periodo.", usaFechas: true },
};

export async function informe(tipo: TipoInforme, p: ParamsInforme) {
  switch (tipo) {
    case "resumen": return resumen(p);
    case "periodo": return periodo(p);
    case "prendas_mas_vendidas": return prendasMasVendidas(p);
    case "prendas_menos_vendidas": return prendasMenosVendidas(p);
    case "notas_credito": return notasCredito(p);
    case "stock": return stock(p);
    case "horarios": return horarios(p);
    case "ingresos": return ingresos(p);
    case "panel": return panelCompleto(p);
  }
}

// Todos los informes juntos (los usa la pantalla y el tipo "panel" de la API).
export async function panelCompleto(p: ParamsInforme) {
  const [r, per, top, menos, notas, st, hor, ing] = await Promise.all([resumen(p), periodo(p), prendasMasVendidas(p), prendasMenosVendidas(p), notasCredito(p), stock(p), horarios(p), ingresos(p)]);
  return { resumen: r, periodo: per, prendasMasVendidas: top, prendasMenosVendidas: menos, notasCredito: notas, stock: st, horarios: hor, ingresos: ing };
}
export type Panel = Awaited<ReturnType<typeof panelCompleto>>;

export const esTipo = (t: string): t is TipoInforme => t === "panel" || t in TIPOS;

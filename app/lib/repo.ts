import type { PoolClient } from "pg";
import { DEPOSITO, empresa } from "./empresa.config";
import { type Db, pool, tx } from "./db";
import {
  capitalizar, nombreSucursal, normalizar, totalReparto,
  calcularPagos, type MedioPago, type PagoEntrada, type Producto, type Reparto, type Tipo, type Traslado,
} from "./util";

// Error esperado: se le muestra el mensaje al usuario.
export class ErrorNegocio extends Error {}
const falla = (m: string): never => {
  throw new ErrorNegocio(m);
};

const SELECT_PRODUCTO = `
  select p.sku, p.tipo, p.nombre, p.precio_lista as precio, p.foto_url as foto, p.creado_en as creado,
    (select max(c.creado_en) from cargas c where c.sku = p.sku) as "ultimoIngreso",
    coalesce((select jsonb_object_agg(x.hasta, x.n) from (
      select t.hasta, sum(t.cantidad - t.cantidad_recibida)::int as n from traslados t
      where t.sku = p.sku and t.estado = 'en_camino' group by t.hasta) x), '{}'::jsonb) as "enCamino",
    coalesce(jsonb_object_agg(s.sucursal_id, s.cantidad) filter (where s.sucursal_id is not null), '{}'::jsonb) as stock
  from productos p left join stock s on s.sku = p.sku`;

type Fila = Omit<Producto, "creado" | "ultimoIngreso"> & { creado: Date; ultimoIngreso: Date | null };
const aProducto = (f: Fila): Producto => ({
  ...f,
  creado: new Date(f.creado).toISOString(),
  ultimoIngreso: new Date(f.ultimoIngreso ?? f.creado).toISOString(),
});

export async function listar(
  f: { q?: string; sucursalConStock?: string; sku?: string; limite?: number } = {},
  db: Db = pool,
): Promise<Producto[]> {
  const params: unknown[] = [];
  const cond = ["p.activo"];
  if (f.sku) {
    params.push(f.sku.trim().toUpperCase());
    cond.push(`p.sku = $${params.length}`);
  }
  for (const t of normalizar(f.q ?? "").replace(/[%_\\]/g, "").split(" ").filter(Boolean)) {
    params.push(`%${t}%`);
    cond.push(`(p.nombre_norm like $${params.length} or lower(p.sku) like $${params.length})`);
  }
  if (f.sucursalConStock) {
    params.push(f.sucursalConStock);
    cond.push(`exists (select 1 from stock x where x.sku = p.sku and x.sucursal_id = $${params.length} and x.cantidad > 0)`);
  }
  params.push(f.limite ?? 100);
  const r = await db.query<Fila>(
    `${SELECT_PRODUCTO} where ${cond.join(" and ")} group by p.sku order by p.creado_en desc limit $${params.length}`,
    params,
  );
  return r.rows.map(aProducto);
}

export async function productoPorSku(sku: string, db: Db = pool) {
  return (await listar({ sku, limite: 1 }, db))[0];
}

export async function listarTipos(db: Db = pool): Promise<Tipo[]> {
  const r = await db.query<Tipo>(
    `select t.codigo, t.nombre, t.alias, count(p.sku) filter (where p.activo)::int as usos
     from tipos t left join productos p on p.tipo = t.codigo
     group by t.codigo, t.nombre, t.alias order by usos desc, t.nombre`,
  );
  return r.rows;
}

// Codigo de 3 letras para una categoria nueva: GAB para "Gabardina". Si ya esta usado, prueba otras combinaciones.
function proponerCodigo(usados: Set<string>, normalizado: string) {
  const letras = normalizado.replace(/[^a-z]/g, "").toUpperCase().slice(0, 8).padEnd(3, "X");
  for (let a = 0; a < letras.length; a++)
    for (let b = a + 1; b < letras.length; b++)
      for (let c = b + 1; c < letras.length; c++) {
        const cod = letras[a] + letras[b] + letras[c];
        if (!usados.has(cod)) return cod;
      }
  for (let n = 1; n < 100; n++) {
    const cod = letras.slice(0, 2) + String.fromCharCode(64 + (n % 26 || 26));
    if (!usados.has(cod)) return cod;
  }
  return falla("No se pudo generar un código para esa categoría. Probá con otro nombre.");
}

// Busca la categoria por nombre o alias; si no existe, la crea (o solo la propone, para la vista previa).
async function resolverTipo(db: Db, categoria: string, crear: boolean) {
  const k = normalizar(categoria);
  if (!k) return { codigo: "OTR", nombre: "Otro", nuevo: false };
  if (k.length > 40) falla("El nombre de la categoría es demasiado largo");
  if (k.replace(/[^a-z]/g, "").length < 2) falla("La categoría tiene que tener al menos 2 letras");
  const r = await db.query<{ codigo: string; nombre: string; alias: string[] }>("select codigo, nombre, alias from tipos");
  const sing = k.replace(/(es|s)$/, "");
  const hit = r.rows.find((t) => normalizar(t.nombre) === k || t.alias.includes(k) || t.alias.includes(sing));
  if (hit) return { codigo: hit.codigo, nombre: hit.nombre, nuevo: false };
  const codigo = proponerCodigo(new Set(r.rows.map((t) => t.codigo)), k);
  const nombre = capitalizar(categoria);
  if (crear) {
    const alias = k.includes(" ") ? [k] : [k, k + "s"];
    await db.query("insert into tipos (codigo, nombre, alias) values ($1, $2, $3)", [codigo, nombre, alias]);
    await db.query("insert into contadores_sku (tipo) values ($1)", [codigo]);
  }
  return { codigo, nombre, nuevo: true };
}

export async function vistaPrevia(a: { categoria: string; nombre: string; precio: number }) {
  const t = await resolverTipo(pool, a.categoria, false);
  const k = normalizar(a.nombre);
  const ex = await pool.query<{ sku: string; total: number; ultimo: Date | null }>(
    `select p.sku, coalesce(sum(s.cantidad), 0)::int as total, (select max(c.creado_en) from cargas c where c.sku = p.sku) as ultimo
     from productos p left join stock s on s.sku = p.sku
     where p.activo and p.tipo = $1 and p.nombre_norm = $2 and p.precio_lista = $3 group by p.sku`,
    [t.codigo, k, a.precio],
  );
  const c = await pool.query<{ siguiente: number }>("select ultimo + 1 as siguiente from contadores_sku where tipo = $1", [t.codigo]);
  const otros = k && a.precio > 0
    ? await pool.query<{ precio: number }>(
        "select precio_lista as precio from productos where activo and tipo = $1 and nombre_norm = $2 and precio_lista <> $3 order by precio_lista",
        [t.codigo, k, a.precio],
      )
    : { rows: [] as { precio: number }[] };
  return {
    sku: ex.rows[0]?.sku ?? t.codigo + String(c.rows[0]?.siguiente ?? 1).padStart(empresa.skuDigitos, "0"),
    existe: ex.rows.length > 0,
    existente: ex.rows[0]
      ? { stockTotal: ex.rows[0].total, ultimoIngreso: ex.rows[0].ultimo ? new Date(ex.rows[0].ultimo).toISOString() : null }
      : null,
    otrosPrecios: otros.rows.map((x) => x.precio),
    tipo: t,
  };
}

async function sumarStock(c: PoolClient, sku: string, sucursal: string, delta: number) {
  await c.query(
    `insert into stock (sku, sucursal_id, cantidad) values ($1, $2, $3)
     on conflict (sku, sucursal_id) do update set cantidad = stock.cantidad + excluded.cantidad`,
    [sku, sucursal, delta],
  );
}

async function stockActual(c: PoolClient, sku: string, sucursal: string) {
  const r = await c.query<{ cantidad: number }>(
    "select cantidad from stock where sku = $1 and sucursal_id = $2 for update",
    [sku, sucursal],
  );
  return r.rows[0]?.cantidad ?? 0;
}

async function mov(
  c: PoolClient, sku: string, cantidad: number, desde: string | null, hasta: string | null,
  tipo: string, extra: { motivo?: string; ventaId?: number } = {},
) {
  await c.query(
    "insert into movimientos (sku, cantidad, desde, hasta, tipo, motivo, venta_id) values ($1, $2, $3, $4, $5, $6, $7)",
    [sku, cantidad, desde, hasta, tipo, extra.motivo ?? null, extra.ventaId ?? null],
  );
}

const esSucursal = (id: string) => empresa.sucursales.some((s) => s.id === id);
const esLocal = (id: string) => esSucursal(id) && id !== DEPOSITO;

// Pasa stock de una sucursal a otras. Desde el deposito es "envio"; el resto es "traslado".
// Envia stock de una sucursal a otras. El stock sale del origen y queda "en camino": recien suma en el
// destino cuando el local lo recibe. Desde el deposito se registra como "envio"; entre sucursales, "traslado".
async function repartir(c: PoolClient, sku: string, desde: string, reparto: Reparto) {
  for (const [destino, n] of Object.entries(reparto)) {
    if (!n || n <= 0 || destino === desde) continue;
    await sumarStock(c, sku, desde, -n);
    await c.query("insert into traslados (sku, cantidad, desde, hasta) values ($1, $2, $3, $4)", [sku, n, desde, destino]);
    await mov(c, sku, n, desde, destino, desde === DEPOSITO ? "envio" : "traslado");
  }
}

function validarReparto(r: Reparto) {
  for (const [id, n] of Object.entries(r)) {
    if (!Number.isInteger(n) || n < 0) falla("Las cantidades tienen que ser números enteros, sin negativos");
    if (n > 0 && !esSucursal(id)) falla("Sucursal inexistente");
  }
}

export async function cargar(a: {
  categoria: string; nombre: string; precio: number; cantidad: number; foto?: string | null; reparto: Reparto;
}) {
  const nombre = capitalizar(a.nombre);
  if (!nombre) falla("Escribí el nombre de la prenda");
  if (nombre.length > 120) falla("El nombre es demasiado largo");
  if (!Number.isInteger(a.precio) || a.precio <= 0) falla("Ingresá el precio de lista");
  if (!Number.isInteger(a.cantidad) || a.cantidad < 1 || a.cantidad > 5000) falla("La cantidad tiene que estar entre 1 y 5000");
  validarReparto(a.reparto);
  if (Object.keys(a.reparto).some((k) => a.reparto[k] > 0 && !esLocal(k))) falla("El reparto es solo para los locales");
  if (totalReparto(a.reparto) > a.cantidad) falla(`Estás enviando ${totalReparto(a.reparto)} prendas pero cargaste ${a.cantidad}`);

  return tx(async (c) => {
    const k = normalizar(nombre);
    const tipo = (await resolverTipo(c, a.categoria, true)).codigo;
    const ex = await c.query<{ sku: string }>(
      "select sku from productos where activo and tipo = $1 and nombre_norm = $2 and precio_lista = $3 for update",
      [tipo, k, a.precio],
    );
    let sku = ex.rows[0]?.sku;
    if (!sku) {
      const n = await c.query<{ ultimo: number }>("update contadores_sku set ultimo = ultimo + 1 where tipo = $1 returning ultimo", [tipo]);
      sku = tipo + String(n.rows[0].ultimo).padStart(empresa.skuDigitos, "0");
      await c.query(
        "insert into productos (sku, tipo, nombre, nombre_norm, precio_lista, foto_url) values ($1, $2, $3, $4, $5, $6)",
        [sku, tipo, nombre, k, a.precio, a.foto ?? null],
      );
    } else if (a.foto) {
      await c.query("update productos set foto_url = coalesce(foto_url, $2) where sku = $1", [sku, a.foto]);
    }
    await sumarStock(c, sku, DEPOSITO, a.cantidad);
    await c.query("insert into cargas (sku, cantidad) values ($1, $2)", [sku, a.cantidad]);
    await mov(c, sku, a.cantidad, null, DEPOSITO, "carga");
    await repartir(c, sku, DEPOSITO, a.reparto);
    return (await productoPorSku(sku, c))!;
  });
}

export async function mover(sku: string, desde: string, reparto: Reparto) {
  if (!esSucursal(desde)) falla("Sucursal de origen inexistente");
  validarReparto(reparto);
  if (reparto[desde]) falla("El origen y el destino no pueden ser la misma sucursal");
  const total = totalReparto(reparto);
  if (total <= 0) falla("Indicá cuántas prendas mover a cada sucursal");
  return tx(async (c) => {
    const p = await productoPorSku(sku, c);
    if (!p) return falla("No existe el producto");
    const hay = await stockActual(c, p.sku, desde);
    if (total > hay) falla(`Querés mover ${total} pero en ${nombreSucursal(desde)} hay ${hay}`);
    await repartir(c, p.sku, desde, reparto);
    return (await productoPorSku(p.sku, c))!;
  });
}

// ---- Traslados: aviso y recepcion ----
const SELECT_TRASLADO = `
  select t.id::int as id, t.sku, p.nombre, t.cantidad, t.cantidad_recibida as recibidas, t.desde, t.hasta, t.creado_en as fecha
  from traslados t join productos p on p.sku = t.sku`;
type FilaTraslado = Omit<Traslado, "fecha"> & { fecha: Date };
const aTraslado = (f: FilaTraslado): Traslado => ({ ...f, fecha: new Date(f.fecha).toISOString() });

// Traslados que todavia no se terminaron de recibir (de un destino, o de todos).
export async function listarPendientes(hasta?: string) {
  const r = await pool.query<FilaTraslado>(
    `${SELECT_TRASLADO} where t.estado = 'en_camino' ${hasta ? "and t.hasta = $1" : ""} order by t.creado_en, t.id`,
    hasta ? [hasta] : [],
  );
  return r.rows.map(aTraslado);
}

export async function contarPendientes(sucursal: string) {
  const r = await pool.query<{ traslados: number; unidades: number }>(
    `select count(*)::int as traslados, coalesce(sum(cantidad - cantidad_recibida), 0)::int as unidades
     from traslados where hasta = $1 and estado = 'en_camino'`,
    [sucursal],
  );
  return r.rows[0];
}

// Recibe unidades en una sucursal contra los traslados pendientes (los mas viejos primero).
async function recibirUnidades(c: PoolClient, sucursal: string, sku: string, cantidad: number, trasladoId?: number) {
  const r = await c.query<{ id: string; cantidad: number; cantidad_recibida: number; desde: string }>(
    `select id, cantidad, cantidad_recibida, desde from traslados
     where estado = 'en_camino' and hasta = $1 and sku = $2 ${trasladoId ? "and id = $3" : ""}
     order by creado_en, id for update`,
    trasladoId ? [sucursal, sku, trasladoId] : [sucursal, sku],
  );
  let falta = cantidad;
  let recibidas = 0;
  let desde = DEPOSITO;
  for (const t of r.rows) {
    if (falta <= 0) break;
    const k = Math.min(t.cantidad - t.cantidad_recibida, falta);
    await c.query(
      `update traslados set cantidad_recibida = cantidad_recibida + $2,
         estado = case when cantidad_recibida + $2 >= cantidad then 'recibido' else estado end,
         recibido_en = case when cantidad_recibida + $2 >= cantidad then now() else recibido_en end
       where id = $1`,
      [t.id, k],
    );
    await sumarStock(c, sku, sucursal, k);
    await mov(c, sku, k, t.desde, sucursal, "recepcion");
    falta -= k;
    recibidas += k;
    desde = t.desde;
  }
  return { recibidas, desde };
}

// Ingreso en un local: se escanea una prenda y se recibe 1 unidad de un traslado pendiente.
export async function recibirPrenda(sucursal: string, sku: string) {
  if (!esLocal(sucursal)) falla("El ingreso es para los locales: elegí la sucursal arriba a la derecha");
  return tx(async (c) => {
    const p = await productoPorSku(sku, c);
    if (!p) return falla(`No existe la prenda ${sku.trim().toUpperCase()}`);
    const r = await recibirUnidades(c, sucursal, p.sku, 1);
    if (r.recibidas === 0) {
      falla(`No hay traslados pendientes de ${p.nombre} hacia este local. Si ya recibiste todo lo enviado, no hace falta escanearla.`);
    }
    return { producto: p, desde: r.desde };
  });
}

export async function recibirTraslado(id: number, sucursal: string) {
  return tx(async (c) => {
    const r = await c.query<{ sku: string; hasta: string; cantidad: number; cantidad_recibida: number; estado: string }>(
      "select sku, hasta, cantidad, cantidad_recibida, estado from traslados where id = $1 for update",
      [id],
    );
    const t = r.rows[0];
    if (!t) return falla("No existe el traslado");
    if (t.estado !== "en_camino") falla("Ese traslado ya estaba cerrado");
    if (t.hasta !== sucursal) falla(`Ese traslado va a ${nombreSucursal(t.hasta)}, no a este local`);
    const res = await recibirUnidades(c, t.hasta, t.sku, t.cantidad - t.cantidad_recibida, id);
    const p = (await productoPorSku(t.sku, c))!;
    return { producto: p, recibidas: res.recibidas };
  });
}

// El destino rechaza o no recibe lo que falta: vuelve al origen.
export async function devolverTraslado(id: number) {
  return tx(async (c) => {
    const r = await c.query<{ sku: string; desde: string; hasta: string; cantidad: number; cantidad_recibida: number; estado: string }>(
      "select sku, desde, hasta, cantidad, cantidad_recibida, estado from traslados where id = $1 for update",
      [id],
    );
    const t = r.rows[0];
    if (!t) return falla("No existe el traslado");
    if (t.estado !== "en_camino") falla("Ese traslado ya estaba cerrado");
    const resto = t.cantidad - t.cantidad_recibida;
    await sumarStock(c, t.sku, t.desde, resto);
    await mov(c, t.sku, resto, t.hasta, t.desde, "deshacer", { motivo: `Traslado #${id} devuelto` });
    await c.query("update traslados set estado = 'devuelto', recibido_en = now() where id = $1", [id]);
    return { devueltas: resto, a: t.desde };
  });
}

// Deshace la ultima unidad recibida de esa prenda en este local (vuelve a quedar "en camino").
export async function deshacerRecepcion(sku: string, sucursal: string) {
  if (!esLocal(sucursal)) falla("Sucursal inexistente");
  return tx(async (c) => {
    const r = await c.query<{ id: string }>(
      `select id from traslados where hasta = $1 and sku = $2 and cantidad_recibida > 0 and estado in ('en_camino', 'recibido')
       order by id desc limit 1 for update`,
      [sucursal, sku],
    );
    if (!r.rows[0]) return falla("No hay recepciones para deshacer");
    const id = r.rows[0].id;
    await c.query(
      "update traslados set cantidad_recibida = cantidad_recibida - 1, estado = 'en_camino', recibido_en = null where id = $1",
      [id],
    );
    await sumarStock(c, sku, sucursal, -1);
    await mov(c, sku, 1, sucursal, null, "deshacer", { motivo: `Recepción deshecha (traslado #${id})` });
  });
}

export async function totalEnSucursal(sucursal: string) {
  const r = await pool.query<{ n: number }>(
    "select coalesce(sum(s.cantidad), 0)::int as n from stock s join productos p on p.sku = s.sku where p.activo and s.sucursal_id = $1",
    [sucursal],
  );
  return r.rows[0].n;
}

// El precio sale siempre de la base, nunca de lo que mande la pantalla.
// Precio y porcentajes salen siempre de la base, nunca de la pantalla. Solo se puede vender lo que hay en la sucursal.
// Pagos: transferencia 0%, efectivo -20%, tarjeta +20%; se puede dividir entre varios medios (ver calcularPagos).
export async function registrarVenta(sucursal: string, items: { sku: string; cant: number }[], pagos: PagoEntrada[]) {
  if (!esSucursal(sucursal)) falla("Sucursal inexistente");
  if (items.length === 0) falla("No hay prendas en la venta");
  for (const i of items) if (!Number.isInteger(i.cant) || i.cant < 1) falla("Cantidad inválida");
  return tx(async (c) => {
    const mr = await c.query<MedioPago>('select id, nombre, ajuste_pct::float8 as "ajustePct" from medios_pago where activo');
    const prods: Producto[] = [];
    for (const i of items) {
      const p = await productoPorSku(i.sku, c);
      if (!p) return falla(`La prenda ${i.sku} ya no existe o fue dada de baja`);
      const hay = await stockActual(c, p.sku, sucursal);
      if (hay < i.cant) {
        falla(hay <= 0
          ? `${p.nombre} no tiene stock en ${nombreSucursal(sucursal)}`
          : `De ${p.nombre} solo hay ${hay} en ${nombreSucursal(sucursal)}`);
      }
      prods.push(p);
    }
    const subtotal = prods.reduce((s, p, i) => s + p.precio * items[i].cant, 0);
    const calc = calcularPagos(subtotal, mr.rows, pagos);
    if (!calc.ok) return falla(calc.motivo);
    const total = calc.total;
    const unico = calc.pagos.length === 1 ? calc.pagos[0] : null;
    const v = await c.query<{ id: number; creado_en: Date }>(
      `insert into ventas (sucursal_id, subtotal_lista, medio_pago_id, ajuste_medio_pago, ajuste_pct_usado, total)
       values ($1, $2, $3, $4, $5, $6) returning id, creado_en`,
      [sucursal, subtotal, unico?.medioId ?? null, total - subtotal, unico?.pct ?? null, total],
    );
    const ventaId = Number(v.rows[0].id);
    for (const p of calc.pagos) {
      await c.query(
        "insert into venta_pagos (venta_id, medio_pago_id, monto, valor_lista, ajuste_pct_usado) values ($1, $2, $3, $4, $5)",
        [ventaId, p.medioId, p.monto, p.valorLista, p.pct],
      );
    }
    for (const [idx, p] of prods.entries()) {
      const cant = items[idx].cant;
      await c.query(
        "insert into venta_items (venta_id, sku, nombre, precio_lista, cantidad) values ($1, $2, $3, $4, $5)",
        [ventaId, p.sku, p.nombre, p.precio, cant],
      );
      await sumarStock(c, p.sku, sucursal, -cant);
      await mov(c, p.sku, cant, sucursal, null, "venta", { ventaId });
    }
    return {
      id: ventaId,
      fecha: v.rows[0].creado_en.toISOString(),
      subtotal,
      ajuste: total - subtotal,
      total,
      pagos: calc.pagos,
      items: prods.map((p, i) => ({ sku: p.sku, nombre: p.nombre, precio: p.precio, cant: items[i].cant })),
    };
  });
}

// Caja del dia de una sucursal: plata cobrada en cada medio (un pago mixto cuenta en cada medio que uso).
export async function ventasDeHoy(sucursal: string) {
  if (!esSucursal(sucursal)) falla("Sucursal inexistente");
  const hoy = `(v.creado_en at time zone 'America/Argentina/Buenos_Aires')::date = (now() at time zone 'America/Argentina/Buenos_Aires')::date`;
  const r = await pool.query<{ id: string; nombre: string; ventas: number; total: number }>(
    `select pg.medio_pago_id as id, m.nombre, count(distinct pg.venta_id)::int as ventas, coalesce(sum(pg.monto), 0)::float8 as total
     from venta_pagos pg join ventas v on v.id = pg.venta_id join medios_pago m on m.id = pg.medio_pago_id
     where v.sucursal_id = $1 and ${hoy} group by pg.medio_pago_id, m.nombre order by m.nombre`,
    [sucursal],
  );
  const n = await pool.query<{ n: number }>(`select count(*)::int as n from ventas v where v.sucursal_id = $1 and ${hoy}`, [sucursal]);
  return { filas: r.rows, ventas: n.rows[0].n };
}

export async function editar(sku: string, a: { nombre: string; precio: number }) {
  const nombre = capitalizar(a.nombre);
  if (!nombre) falla("El nombre no puede quedar vacío");
  if (!Number.isInteger(a.precio) || a.precio <= 0) falla("Ingresá un precio válido");
  try {
    const r = await pool.query(
      "update productos set nombre = $2, nombre_norm = $3, precio_lista = $4 where sku = $1 and activo",
      [sku, nombre, normalizar(nombre), a.precio],
    );
    if (r.rowCount === 0) falla("No existe el producto");
  } catch (e) {
    if ((e as { code?: string }).code === "23505") falla("Ya existe otro producto con ese mismo nombre y precio");
    throw e;
  }
  return (await productoPorSku(sku))!;
}

export async function ajustarStock(sku: string, sucursal: string, nueva: number, motivo: string) {
  if (!esSucursal(sucursal)) falla("Sucursal inexistente");
  if (!Number.isInteger(nueva) || nueva < 0) falla("La cantidad tiene que ser un entero desde 0");
  if (!motivo.trim()) falla("Indicá el motivo del ajuste");
  return tx(async (c) => {
    const p = await productoPorSku(sku, c);
    if (!p) return falla("No existe el producto");
    const actual = await stockActual(c, p.sku, sucursal);
    const delta = nueva - actual;
    if (delta === 0) falla("La cantidad es la misma que ya figura");
    await sumarStock(c, p.sku, sucursal, delta);
    await mov(c, p.sku, Math.abs(delta), delta < 0 ? sucursal : null, delta > 0 ? sucursal : null, "ajuste", { motivo: motivo.trim() });
    return (await productoPorSku(p.sku, c))!;
  });
}

// Baja logica: se oculta, pero las ventas y movimientos anteriores se conservan.
export async function eliminar(sku: string) {
  return tx(async (c) => {
    const p = await productoPorSku(sku, c);
    if (!p) return falla("No existe el producto");
    for (const [suc, n] of Object.entries(p.stock)) {
      if (n === 0) continue;
      await sumarStock(c, p.sku, suc, -n);
      await mov(c, p.sku, Math.abs(n), n > 0 ? suc : null, n < 0 ? suc : null, "ajuste", { motivo: "Producto eliminado" });
    }
    await c.query("update productos set activo = false, eliminado_en = now() where sku = $1", [p.sku]);
  });
}


export async function listarMediosPago(): Promise<MedioPago[]> {
  const r = await pool.query<MedioPago>(
    `select id, nombre, ajuste_pct::float8 as "ajustePct" from medios_pago where activo
     order by case id when 'transferencia' then 0 when 'efectivo' then 1 else 2 end, nombre`,
  );
  return r.rows;
}

export async function ingresosDe(sku: string) {
  const r = await pool.query<{ fecha: Date; cantidad: number }>(
    "select creado_en as fecha, cantidad from cargas where sku = $1 order by creado_en desc limit 30",
    [sku.trim().toUpperCase()],
  );
  return r.rows.map((x) => ({ fecha: new Date(x.fecha).toISOString(), cantidad: x.cantidad }));
}

export async function resumenSucursal(sucursal: string) {
  if (!esSucursal(sucursal)) falla("Sucursal inexistente");
  const r = await pool.query<{ prendas: number; modelos: number; valor: number }>(
    `select coalesce(sum(s.cantidad), 0)::float8 as prendas,
            count(*) filter (where s.cantidad > 0)::int as modelos,
            coalesce(sum(s.cantidad * p.precio_lista), 0)::float8 as valor
     from stock s join productos p on p.sku = s.sku where p.activo and s.sucursal_id = $1`,
    [sucursal],
  );
  return r.rows[0];
}

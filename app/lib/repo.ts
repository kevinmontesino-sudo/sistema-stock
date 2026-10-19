import type { PoolClient } from "pg";
import { DEPOSITO, empresa } from "./empresa.config";
import { type Db, pool, tx } from "./db";
import { usuarioEnCurso } from "./seguridad/contexto";
import {
  capitalizar, nombreSucursal, normalizar, totalReparto,
  calcularPagos, DIAS_DEVOLUCION, type MedioPago, type NotaCredito, type VentaDevolvible, type PagoEntrada, type Producto, type Reparto, type Tipo, type Traslado,
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
    "insert into movimientos (sku, cantidad, desde, hasta, tipo, motivo, venta_id, usuario_id) values ($1, $2, $3, $4, $5, $6, $7, $8)",
    [sku, cantidad, desde, hasta, tipo, extra.motivo ?? null, extra.ventaId ?? null, usuarioEnCurso()?.id ?? null],
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
    await c.query("insert into cargas (sku, cantidad, usuario_id) values ($1, $2, $3)", [sku, a.cantidad, usuarioEnCurso()?.id ?? null]);
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
export async function registrarVenta(sucursal: string, itemsPedidos: { sku: string; cant: number }[], pagos: PagoEntrada[], clave?: string) {
  if (!esSucursal(sucursal)) falla("Sucursal inexistente");
  if (itemsPedidos.length === 0) falla("No hay prendas en la venta");
  for (const i of itemsPedidos) if (!Number.isInteger(i.cant) || i.cant < 1) falla("Cantidad inválida");
  // Siempre se bloquean las prendas en el mismo orden (por SKU): dos ventas al mismo tiempo no se traban entre si.
  const items = [...itemsPedidos].sort((a, b) => a.sku.localeCompare(b.sku));
  return tx(async (c) => {
    // Un reintento del mismo cobro (misma clave) devuelve la venta ya registrada en vez de duplicarla.
    if (clave) {
      await c.query("select pg_advisory_xact_lock(hashtext($1))", [clave]);
      const previa = await c.query<{ id: number }>("select id::int as id from ventas where clave = $1", [clave]);
      if (previa.rows[0]) return ticketDeVenta(c, previa.rows[0].id);
    }
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
    // Pagos con nota de credito ("nota:N000001"): se bloquea la nota, se valida y entra como un medio mas con su propio ajuste.
    const notas = new Map<string, { id: number; saldo: number }>();
    const medios = [...mr.rows];
    const pagosOk: PagoEntrada[] = [];
    for (const p of pagos) {
      if (!p.medioId.toLowerCase().startsWith("nota:")) { pagosOk.push(p); continue; }
      const cod = p.medioId.slice(5).trim().toUpperCase();
      if (notas.has(cod)) return falla(`La nota ${cod} está repetida`);
      const n = await c.query<{ id: number; saldo: number; ajustePct: number }>(
        `select id::int as id, saldo, ajuste_pct::float8 as "ajustePct" from notas_credito where codigo = $1 for update`,
        [cod],
      );
      const nota = n.rows[0];
      if (!nota) return falla(`No existe la nota de crédito ${cod}`);
      if (nota.saldo <= 0) return falla(`La nota ${cod} ya fue usada`);
      if (p.monto === null || p.monto > nota.saldo) return falla(`La nota ${cod} tiene ${nota.saldo} de saldo`);
      notas.set(cod, { id: nota.id, saldo: nota.saldo });
      medios.push({ id: `nota:${cod}`, nombre: `Nota de crédito ${cod}`, ajustePct: nota.ajustePct });
      pagosOk.push({ medioId: `nota:${cod}`, monto: p.monto });
    }
    const calc = calcularPagos(subtotal, medios, pagosOk);
    if (!calc.ok) return falla(calc.motivo);
    // Control de seguridad: las cuentas tienen que cerrar siempre. Si algo no cierra, la venta no se registra.
    const sumaMontos = calc.pagos.reduce((t, p) => t + p.monto, 0);
    const sumaLista = calc.pagos.reduce((t, p) => t + p.valorLista, 0);
    if (sumaMontos !== calc.total || Math.abs(sumaLista - subtotal) > 1 || calc.pagos.some((p) => p.monto < 0)) {
      console.error("[venta] las cuentas no cierran", { subtotal, total: calc.total, sumaMontos, sumaLista, pagos: calc.pagos });
      return falla("Las cuentas de la venta no cierran. No se registró nada: avisá a quien administra el sistema.");
    }
    const total = calc.total;
    const unico = calc.pagos.length === 1 ? calc.pagos[0] : null;
    const v = await c.query<{ id: number; creado_en: Date }>(
      `insert into ventas (sucursal_id, subtotal_lista, medio_pago_id, ajuste_medio_pago, ajuste_pct_usado, total, clave, usuario_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id, creado_en`,
      [sucursal, subtotal, unico ? (unico.medioId.startsWith("nota:") ? "nota_credito" : unico.medioId) : null, total - subtotal, unico?.pct ?? null, total, clave ?? null, usuarioEnCurso()?.id ?? null],
    );
    const ventaId = Number(v.rows[0].id);
    for (const p of calc.pagos) {
      const nota = p.medioId.startsWith("nota:") ? notas.get(p.medioId.slice(5)) : undefined;
      await c.query(
        "insert into venta_pagos (venta_id, medio_pago_id, monto, valor_lista, ajuste_pct_usado, nota_credito_id) values ($1, $2, $3, $4, $5, $6)",
        [ventaId, nota ? "nota_credito" : p.medioId, p.monto, p.valorLista, p.pct, nota?.id ?? null],
      );
      if (nota) await c.query("update notas_credito set saldo = saldo - $2 where id = $1", [nota.id, p.monto]);
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

// Arma de nuevo el ticket de una venta ya registrada (para devolverlo si el cobro se reintenta).
async function ticketDeVenta(c: PoolClient, id: number) {
  const v = await c.query<{ creado_en: Date; subtotal_lista: number; total: number }>("select creado_en, subtotal_lista, total from ventas where id = $1", [id]);
  const it = await c.query<{ sku: string; nombre: string; precio: number; cant: number }>(
    "select sku, nombre, precio_lista as precio, cantidad as cant from venta_items where venta_id = $1 order by id", [id]);
  const pg = await c.query<{ medioId: string; nombre: string; pct: number; monto: number; valorLista: number; codigo: string | null }>(
    `select case when p.nota_credito_id is null then p.medio_pago_id else 'nota:' || n.codigo end as "medioId",
       case when p.nota_credito_id is null then m.nombre else 'Nota de crédito ' || n.codigo end as nombre,
       p.ajuste_pct_usado::float8 as pct, p.monto, p.valor_lista as "valorLista", n.codigo
     from venta_pagos p join medios_pago m on m.id = p.medio_pago_id left join notas_credito n on n.id = p.nota_credito_id
     where p.venta_id = $1 order by p.id`, [id]);
  return {
    id, fecha: v.rows[0].creado_en.toISOString(), subtotal: v.rows[0].subtotal_lista, ajuste: v.rows[0].total - v.rows[0].subtotal_lista,
    total: v.rows[0].total, pagos: pg.rows.map((p) => ({ medioId: p.medioId, nombre: p.nombre, pct: p.pct, monto: p.monto, valorLista: p.valorLista })), items: it.rows,
  };
}

// Caja del dia de una sucursal: plata cobrada en cada medio (un pago mixto cuenta en cada medio que uso).
export async function ventasDeHoy(sucursal: string) {
  if (!esSucursal(sucursal)) falla("Sucursal inexistente");
  // Rango de hoy (hora de Argentina) para que use el indice por local y fecha.
  const hoy = `v.creado_en >= (date_trunc('day', now() at time zone 'America/Argentina/Buenos_Aires') at time zone 'America/Argentina/Buenos_Aires')`;
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

// Traslados de un origen a un destino para armar el remito: lo que sigue en camino o, si se da un dia (AAAA-MM-DD), todo lo enviado ese dia.
export async function trasladosParaRemito(desde: string, hasta: string, dia?: string) {
  const r = await pool.query<FilaTraslado>(
    `${SELECT_TRASLADO} where t.desde = $1 and t.hasta = $2 and t.estado <> 'devuelto'
       and ${dia ? "(t.creado_en at time zone 'America/Argentina/Buenos_Aires')::date = $3::date" : "t.estado = 'en_camino'"}
     order by t.creado_en, t.id`,
    dia ? [desde, hasta, dia] : [desde, hasta],
  );
  return r.rows.map(aTraslado);
}

// ---- Notas de credito: devoluciones ----
const SELECT_NOTA = `
  select n.id::int as id, n.codigo, n.venta_id::int as "ventaId", n.sucursal_id as sucursal, n.creado_en as creada,
    n.monto_inicial as "montoInicial", n.saldo, n.ajuste_pct::float8 as "ajustePct",
    coalesce((select jsonb_agg(jsonb_build_object('nombre', vi.nombre, 'cantidad', ni.cantidad, 'monto', ni.monto, 'falladas', ni.falladas) order by ni.id)
              from nota_credito_items ni join venta_items vi on vi.id = ni.venta_item_id where ni.nota_id = n.id), '[]'::jsonb) as items
  from notas_credito n`;
type FilaNota = Omit<NotaCredito, "creada" | "estado"> & { creada: Date };
const aNota = (f: FilaNota): NotaCredito => ({
  codigo: f.codigo, ventaId: f.ventaId, sucursal: f.sucursal, creada: new Date(f.creada).toISOString(),
  montoInicial: f.montoInicial, saldo: f.saldo, ajustePct: f.ajustePct, items: f.items,
  estado: f.saldo <= 0 ? "usada" : "vigente",
});

export async function notaPorCodigo(codigo: string) {
  const r = await pool.query<FilaNota>(`${SELECT_NOTA} where n.codigo = $1`, [codigo.trim().toUpperCase()]);
  if (!r.rows[0]) falla(`No existe la nota de crédito ${codigo.trim().toUpperCase()}`);
  return aNota(r.rows[0]);
}

// Con que se pago una venta, en proporcion: la nota de una prenda vale lo que se pago por ella (con el ajuste del medio).
const factorDeVenta = (v: { total: number; subtotal_lista: number; descuento_promo: number }) => {
  const base = v.subtotal_lista - v.descuento_promo;
  return base > 0 ? v.total / base : 1;
};

// Busca una venta por el codigo de su ticket (V000123, o solo el numero) para devolver prendas.
export async function ventaParaDevolucion(codigo: string): Promise<VentaDevolvible> {
  const m = codigo.trim().match(/^v?0*(\d+)$/i);
  if (!m) return falla("Escaneá el código de barras del ticket de venta (empieza con V)");
  const v = await pool.query<{ id: number; creado_en: Date; sucursal_id: string; total: number; subtotal_lista: number; descuento_promo: number }>(
    "select id::int as id, creado_en, sucursal_id, total, subtotal_lista, descuento_promo from ventas where id = $1", [Number(m[1])],
  );
  const venta = v.rows[0];
  if (!venta) return falla(`No existe la venta N° ${Number(m[1])}`);
  if (Date.now() - venta.creado_en.getTime() > DIAS_DEVOLUCION * 86_400_000) {
    return falla(`Esa compra es del ${venta.creado_en.toLocaleDateString("es-AR")}: pasaron más de ${DIAS_DEVOLUCION} días y ya no se acepta la devolución`);
  }
  const f = factorDeVenta(venta);
  const it = await pool.query<{ id: number; sku: string; nombre: string; precio: number; vendidas: number; devueltas: number }>(
    `select vi.id::int as id, vi.sku, vi.nombre, vi.precio_lista as precio, vi.cantidad as vendidas,
       coalesce((select sum(ni.cantidad) from nota_credito_items ni where ni.venta_item_id = vi.id), 0)::int as devueltas
     from venta_items vi where vi.venta_id = $1 order by vi.id`, [venta.id],
  );
  return {
    id: venta.id, fecha: venta.creado_en.toISOString(), sucursal: venta.sucursal_id, total: venta.total,
    items: it.rows.map((x) => ({ ...x, valor: Math.round(x.precio * f) })),
  };
}

// Emite una nota de credito: devuelve las prendas elegidas al stock de la sucursal y deja un saldo a favor por 15 dias.
// `falladas` = unidades del renglon que estan falladas: esas dan igual la nota, pero NO vuelven al stock.
export async function emitirNota(sucursal: string, ventaId: number, items: { itemId: number; cant: number; falladas: number }[]) {
  if (!esSucursal(sucursal)) falla("Sucursal inexistente");
  const pedidos = items.filter((i) => i.cant > 0).sort((a, b) => a.itemId - b.itemId);
  if (pedidos.length === 0) falla("Elegí al menos una prenda para devolver");
  for (const i of pedidos) {
    if (!Number.isInteger(i.cant) || !Number.isInteger(i.itemId) || !Number.isInteger(i.falladas) || i.falladas < 0 || i.falladas > i.cant) falla("Cantidad inválida");
  }
  return tx(async (c) => {
    const v = await c.query<{ total: number; subtotal_lista: number; descuento_promo: number; fuera: boolean }>(
      `select total, subtotal_lista, descuento_promo, creado_en < now() - interval '${DIAS_DEVOLUCION} days' as fuera from ventas where id = $1 for update`, [ventaId],
    );
    if (!v.rows[0]) return falla("No existe esa venta");
    if (v.rows[0].fuera) return falla(`Pasaron más de ${DIAS_DEVOLUCION} días desde la compra: ya no se acepta la devolución`);
    const f = factorDeVenta(v.rows[0]);
    const vi = await c.query<{ id: number; sku: string; nombre: string; precio: number; vendidas: number; devueltas: number }>(
      `select vi.id::int as id, vi.sku, vi.nombre, vi.precio_lista as precio, vi.cantidad as vendidas,
         coalesce((select sum(ni.cantidad) from nota_credito_items ni where ni.venta_item_id = vi.id), 0)::int as devueltas
       from venta_items vi where vi.venta_id = $1`, [ventaId],
    );
    const filas: { item: (typeof vi.rows)[number]; cant: number; falladas: number; monto: number }[] = [];
    for (const p of pedidos) {
      const item = vi.rows.find((x) => x.id === p.itemId);
      if (!item) return falla("Una de las prendas no pertenece a esa venta");
      if (p.cant > item.vendidas - item.devueltas) {
        return falla(`De ${item.nombre} se vendieron ${item.vendidas} y ya se devolvieron ${item.devueltas}: solo se pueden devolver ${item.vendidas - item.devueltas}`);
      }
      filas.push({ item, cant: p.cant, falladas: p.falladas, monto: Math.round(item.precio * p.cant * f) });
    }
    const monto = filas.reduce((s, x) => s + x.monto, 0);
    if (monto <= 0) return falla("Esa devolución no tiene valor");
    const n = await c.query<{ id: number; codigo: string }>(
      `insert into notas_credito (venta_id, sucursal_id, monto_inicial, saldo, ajuste_pct, usuario_id)
       values ($1, $2, $3, $3, $4, $5) returning id::int as id, codigo`,
      [ventaId, sucursal, monto, Math.round((f - 1) * 1_000_000) / 10_000, usuarioEnCurso()?.id ?? null],
    );
    for (const x of filas) {
      await c.query(
        "insert into nota_credito_items (nota_id, venta_item_id, sku, cantidad, falladas, monto) values ($1, $2, $3, $4, $5, $6)",
        [n.rows[0].id, x.item.id, x.item.sku, x.cant, x.falladas, x.monto],
      );
      // Las falladas no vuelven al stock: solo se reponen las que estan bien.
      const buenas = x.cant - x.falladas;
      if (buenas > 0) {
        await sumarStock(c, x.item.sku, sucursal, buenas);
        await mov(c, x.item.sku, buenas, null, sucursal, "devolucion", { ventaId, motivo: `Nota de crédito ${n.rows[0].codigo}` });
      }
    }
    const r = await c.query<FilaNota>(`${SELECT_NOTA} where n.id = $1`, [n.rows[0].id]);
    return aNota(r.rows[0]);
  });
}

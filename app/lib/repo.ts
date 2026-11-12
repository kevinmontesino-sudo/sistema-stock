import type { PoolClient } from "pg";
import { DEPOSITO, empresa } from "./empresa.config";
import { type Db, pool, tx } from "./db";
import { usuarioEnCurso } from "./seguridad/contexto";
import { descuentoEspecial, mediosParaPromo, mejorPromo, TOPE_PCT, type Promo } from "./promos";
import { auditar } from "./seguridad/auditoria";
import {
  capitalizar, nombreSucursal, normalizar, totalReparto,
  calcularPagos, mediosDelCarrito, NO_ANULADA, DIAS_DEVOLUCION, ES_CODIGO_VENTA, type MedioPago, type NotaCredito, type VentaDevolvible, type VentaListada, type PagoEntrada, type Producto, type Reparto, type Tipo, type Traslado,
} from "./util";

// Error esperado: se le muestra el mensaje al usuario.
export class ErrorNegocio extends Error {}
const falla = (m: string): never => {
  throw new ErrorNegocio(m);
};

const SELECT_PRODUCTO = `
  select p.sku, p.tipo, p.nombre, p.precio_lista as precio, p.precios_medio as "preciosMedio", p.foto_url as foto, p.creado_en as creado,
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
    // Puede ser una sola sucursal o varias separadas por coma (el deposito vende tambien con el stock de San Lorenzo).
    params.push(f.sucursalConStock.split(",").map((x) => x.trim()).filter(Boolean));
    cond.push(`exists (select 1 from stock x where x.sku = p.sku and x.sucursal_id = any($${params.length}::text[]) and x.cantidad > 0)`);
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

export async function vistaPrevia(a: { categoria: string; nombre: string; precio: number; unico?: boolean }) {
  const t = await resolverTipo(pool, a.categoria, false);
  // Producto unico: siempre SKU nuevo, no se compara con lo ya cargado.
  const k = a.unico ? "" : normalizar(a.nombre);
  const ex = await pool.query<{ sku: string; total: number; ultimo: Date | null }>(
    `select p.sku, coalesce(sum(s.cantidad), 0)::int as total, (select max(c.creado_en) from cargas c where c.sku = p.sku) as ultimo
     from productos p left join stock s on s.sku = p.sku
     where p.activo and p.precios_medio is null and p.tipo = $1 and p.nombre_norm = $2 and p.precio_lista = $3 group by p.sku`,
    [t.codigo, k, a.precio],
  );
  const c = await pool.query<{ siguiente: number }>("select ultimo + 1 as siguiente from contadores_sku where tipo = $1", [t.codigo]);
  const otros = k && a.precio > 0
    ? await pool.query<{ precio: number }>(
        "select precio_lista as precio from productos where activo and precios_medio is null and tipo = $1 and nombre_norm = $2 and precio_lista <> $3 order by precio_lista",
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
  // Producto unico: precio de efectivo a mano. Transferencia, tarjeta y el resto de los medios quedan al precio de lista.
  efectivoUnico?: number | null;
}) {
  const nombre = capitalizar(a.nombre);
  if (!nombre) falla("Escribí el nombre de la prenda");
  if (nombre.length > 120) falla("El nombre es demasiado largo");
  if (!Number.isInteger(a.precio) || a.precio <= 0 || a.precio > 10_000_000) falla("Ingresá un precio de lista válido");
  if (!Number.isInteger(a.cantidad) || a.cantidad < 1 || a.cantidad > 5000) falla("La cantidad tiene que estar entre 1 y 5000");
  validarReparto(a.reparto);
  if (Object.keys(a.reparto).some((k) => a.reparto[k] > 0 && !esLocal(k))) falla("El reparto es solo para los locales");
  if (totalReparto(a.reparto) > a.cantidad) falla(`Estás enviando ${totalReparto(a.reparto)} prendas pero cargaste ${a.cantidad}`);
  const unico = a.efectivoUnico != null;
  if (unico && (!Number.isInteger(a.efectivoUnico) || a.efectivoUnico! <= 0 || a.efectivoUnico! > a.precio)) falla("El precio de efectivo tiene que ser mayor a 0 y no más que el de lista");

  return tx(async (c) => {
    const k = normalizar(nombre);
    const tipo = (await resolverTipo(c, a.categoria, true)).codigo;
    const ex = unico ? { rows: [] as { sku: string }[] } : await c.query<{ sku: string }>(
      "select sku from productos where activo and precios_medio is null and tipo = $1 and nombre_norm = $2 and precio_lista = $3 for update",
      [tipo, k, a.precio],
    );
    let sku = ex.rows[0]?.sku;
    if (!sku) {
      let fijos: Record<string, number> | null = null;
      if (unico) {
        const mr = await c.query<{ id: string }>("select id from medios_pago where activo");
        fijos = Object.fromEntries(mr.rows.map((m) => [m.id, m.id === "efectivo" ? a.efectivoUnico! : a.precio]));
        if (!("efectivo" in fijos)) falla("No está el medio de pago Efectivo");
      }
      const n = await c.query<{ ultimo: number }>("update contadores_sku set ultimo = ultimo + 1 where tipo = $1 returning ultimo", [tipo]);
      sku = tipo + String(n.rows[0].ultimo).padStart(empresa.skuDigitos, "0");
      await c.query(
        "insert into productos (sku, tipo, nombre, nombre_norm, precio_lista, foto_url, precios_medio) values ($1, $2, $3, $4, $5, $6, $7)",
        [sku, tipo, nombre, k, a.precio, a.foto ?? null, fijos ? JSON.stringify(fijos) : null],
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

// Avisos para la cabecera: lo que le mandaron a esta sucursal (por origen) y lo que ella mando y el destino
// todavia no confirmo (por destino). "desde" es la hora del envio pendiente mas viejo.
export type AvisoEnvio = { sucursal: string; unidades: number; desde: string };
export async function avisosDe(sucursal: string): Promise<{ entrantes: AvisoEnvio[]; salientes: AvisoEnvio[] }> {
  const r = await pool.query<{ tipo: "entra" | "sale"; sucursal: string; unidades: number; desde: Date }>(
    `select case when hasta = $1 then 'entra' else 'sale' end as tipo,
            case when hasta = $1 then desde else hasta end as sucursal,
            sum(cantidad - cantidad_recibida)::int as unidades, min(creado_en) as desde
     from traslados where estado = 'en_camino' and (hasta = $1 or desde = $1)
     group by 1, 2 order by 4`,
    [sucursal],
  );
  const de = (t: "entra" | "sale") =>
    r.rows.filter((f) => f.tipo === t && f.unidades > 0).map((f) => ({ sucursal: f.sucursal, unidades: f.unidades, desde: new Date(f.desde).toISOString() }));
  return { entrantes: de("entra"), salientes: de("sale") };
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
// Pagos: cada medio lleva su porcentaje de la tabla medios_pago (se puede dividir entre varios medios, ver calcularPagos).
// Promos vigentes HOY (hora de Argentina) en un local.
const SELECT_PROMO = `select id::int as id, nombre, tipo, n, m, pct::float8 as pct, precio, tipos, sucursales, desde::text as desde, hasta::text as hasta,
  descuento_efectivo as "descuentoEfectivo", sin_cambio as "sinCambio",
  (select coalesce(array_agg(t.nombre order by t.nombre), '{}') from tipos t where t.codigo = any(promos.tipos)) as categorias from promos`;
export async function promosVigentes(sucursal: string, db: Db = pool): Promise<Promo[]> {
  const r = await db.query<Promo>(
    `${SELECT_PROMO} where activa and (cardinality(sucursales) = 0 or $1 = any(sucursales))
       and (now() at time zone 'America/Argentina/Buenos_Aires')::date between desde and hasta order by id`,
    [sucursal],
  );
  return r.rows;
}

// Descuento especial (lo hace un encargado y lo tiene que haber consultado): porcentaje, motivo y quien lo autorizo.
export type Especial = { pct: number; motivo: string; autorizo: string };
function validarEspecial(e: Especial) {
  if (!Number.isFinite(e.pct) || e.pct < 1 || e.pct > TOPE_PCT || Math.round(e.pct * 2) !== e.pct * 2) falla(`El descuento especial tiene que ser de 1% a ${TOPE_PCT}%`);
  const motivo = e.motivo.trim().replace(/\s+/g, " ");
  const autorizo = e.autorizo.trim().replace(/\s+/g, " ");
  if (motivo.length < 5 || motivo.length > 200) falla("Escribí el motivo del descuento especial");
  if (autorizo.length < 2 || autorizo.length > 60) falla("Escribí quién autorizó el descuento especial");
  return { pct: e.pct, motivo, autorizo };
}

// totalEsperado: lo que la caja le dijo al cliente. Si el servidor calcula otro total (cambiaron las promos), no se registra nada.
// origen: de que stock sale cada renglon. Solo el deposito puede vender con stock de San Lorenzo (estan en el mismo lugar); el resto sale siempre de su propio local.
export const ORIGENES_DEPOSITO = [DEPOSITO, "sanlorenzo"];
export async function registrarVenta(sucursal: string, itemsPedidos: { sku: string; cant: number; origen?: string }[], pagos: PagoEntrada[], clave?: string, especialPedido?: Especial, totalEsperado?: number) {
  if (!esSucursal(sucursal)) falla("Sucursal inexistente");
  const especial = especialPedido ? validarEspecial(especialPedido) : null;
  if (itemsPedidos.length === 0) falla("No hay prendas en la venta");
  for (const i of itemsPedidos) {
    if (!Number.isInteger(i.cant) || i.cant < 1) falla("Cantidad inválida");
    if (i.origen && i.origen !== sucursal && !(sucursal === DEPOSITO && ORIGENES_DEPOSITO.includes(i.origen))) falla("Ese local no puede vender con el stock de otra sucursal");
  }
  // Siempre se bloquean las prendas en el mismo orden (por SKU y origen): dos ventas al mismo tiempo no se traban entre si.
  const items = itemsPedidos.map((i) => ({ ...i, origen: i.origen || sucursal })).sort((a, b) => a.sku.localeCompare(b.sku) || a.origen.localeCompare(b.origen));
  // Un mismo SKU de un mismo origen no puede aparecer dos veces (se controla el stock sobre el total).
  if (new Set(items.map((i) => `${i.sku}|${i.origen}`)).size !== items.length) falla("Hay una prenda repetida en la venta");
  return tx(async (c) => {
    // Un reintento del mismo cobro (misma clave) devuelve la venta ya registrada en vez de duplicarla.
    if (clave) {
      await c.query("select pg_advisory_xact_lock(hashtext($1))", [clave]);
      const previa = await c.query<{ id: number }>("select id::int as id from ventas where clave = $1", [clave]);
      if (previa.rows[0]) {
        if ((await c.query("select 1 from ventas_anuladas where venta_id = $1", [previa.rows[0].id])).rowCount) return falla("Esa venta ya se registró y después fue anulada. Volvé a armarla desde cero.");
        return { ...(await ticketDeVenta(c, previa.rows[0].id)), nueva: false };
      }
    }
    const mr = await c.query<MedioPago>('select id, nombre, ajuste_pct::float8 as "ajustePct" from medios_pago where activo');
    const prods: Producto[] = [];
    for (const i of items) {
      const p = await productoPorSku(i.sku, c);
      if (!p) return falla(`La prenda ${i.sku} ya no existe o fue dada de baja`);
      const hay = await stockActual(c, p.sku, i.origen);
      if (hay < i.cant) {
        falla(hay <= 0
          ? `${p.nombre} no tiene stock en ${nombreSucursal(i.origen)}`
          : `De ${p.nombre} solo hay ${hay} en ${nombreSucursal(i.origen)}`);
      }
      prods.push(p);
    }
    const subtotal = prods.reduce((s, p, i) => s + p.precio * items[i].cant, 0);
    // Promo: la elige el servidor con las promos de la base (lo que diga la pantalla no cuenta). El descuento especial la reemplaza.
    const auto = especial ? { promo: null, descuento: 0, detalle: null } : mejorPromo(await promosVigentes(sucursal, c), prods.map((p, i) => ({ tipo: p.tipo, precio: p.precio, cant: items[i].cant })));
    const descuento = especial ? descuentoEspecial(subtotal, especial.pct) : auto.descuento;
    const promoNombre = especial ? `Descuento especial (${especial.pct}%)` : auto.promo ? `Promo ${auto.promo.nombre}` : null;
    // Lo que se paga a "precio de lista" despues de la promo: sobre eso se aplican los medios de pago.
    const neto = subtotal - descuento;
    // Pagos con nota de credito ("nota:N000001"): se bloquea la nota, se valida y entra como un medio mas con su propio ajuste.
    const notas = new Map<string, { id: number; saldo: number }>();
    // Una promo "sin descuento de efectivo" (feria, mayorista): los medios con descuento pasan a 0% (precio unico; ver mediosParaPromo).
    // Productos unicos (precio a mano por medio): cada medio toma el % que da el carrito. Con una promo de precio unico no se usan.
    const sinDescEfvo = !!auto.promo && !auto.promo.descuentoEfectivo;
    const medios = sinDescEfvo ? mediosParaPromo(mr.rows, auto.promo)
      : mediosDelCarrito(mr.rows, prods.map((p, i) => ({ precio: p.precio, preciosMedio: p.preciosMedio, cant: items[i].cant })));
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
    const calc = calcularPagos(neto, medios, pagosOk);
    if (!calc.ok) return falla(calc.motivo);
    // Control de seguridad: las cuentas tienen que cerrar siempre. Si algo no cierra, la venta no se registra.
    const sumaMontos = calc.pagos.reduce((t, p) => t + p.monto, 0);
    const sumaLista = calc.pagos.reduce((t, p) => t + p.valorLista, 0);
    if (sumaMontos !== calc.total || Math.abs(sumaLista - neto) > 1 || calc.pagos.some((p) => p.monto < 0) || descuento < 0 || neto < 0) {
      console.error("[venta] las cuentas no cierran", { subtotal, descuento, total: calc.total, sumaMontos, sumaLista, pagos: calc.pagos });
      return falla("Las cuentas de la venta no cierran. No se registró nada: avisá a quien administra el sistema.");
    }
    const total = calc.total;
    if (totalEsperado !== undefined && totalEsperado !== total) {
      return falla(`Cambiaron las promos: el total ahora es $ ${total.toLocaleString("es-AR")} (la pantalla decía $ ${totalEsperado.toLocaleString("es-AR")}). Avisale al cliente y tocá Cobrar de nuevo.`);
    }
    const unico = calc.pagos.length === 1 ? calc.pagos[0] : null;
    const v = await c.query<{ id: number; codigo: string; creado_en: Date }>(
      `insert into ventas (sucursal_id, subtotal_lista, medio_pago_id, ajuste_medio_pago, ajuste_pct_usado, total, clave, usuario_id,
         descuento_promo, promo_id, promo_nombre, especial_pct, especial_motivo, especial_autorizo)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id, codigo, creado_en`,
      [sucursal, subtotal, unico ? (unico.medioId.startsWith("nota:") ? "nota_credito" : unico.medioId) : null, total - neto, unico?.pct ?? null, total, clave ?? null, usuarioEnCurso()?.id ?? null,
        descuento, auto.promo?.id ?? null, promoNombre, especial?.pct ?? null, especial?.motivo ?? null, especial?.autorizo ?? null],
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
    const sinCambio = prods.map((_, i) => !!(auto.promo?.sinCambio && auto.detalle?.entran[i]));
    for (const [idx, p] of prods.entries()) {
      const cant = items[idx].cant;
      await c.query(
        "insert into venta_items (venta_id, sku, nombre, precio_lista, cantidad, sin_cambio, stock_de) values ($1, $2, $3, $4, $5, $6, $7)",
        [ventaId, p.sku, p.nombre, p.precio, cant, sinCambio[idx], items[idx].origen === sucursal ? null : items[idx].origen],
      );
      await sumarStock(c, p.sku, items[idx].origen, -cant);
      await mov(c, p.sku, cant, items[idx].origen, null, "venta", { ventaId, ...(items[idx].origen !== sucursal ? { motivo: `Vendido desde ${nombreSucursal(sucursal)} con stock de ${nombreSucursal(items[idx].origen)}` } : {}) });
    }
    // En la misma transaccion: si la venta se registra, el descuento especial queda auditado (y un reintento no lo duplica).
    if (especial) {
      await auditar("descuento_especial", { venta: v.rows[0].codigo, sucursal, pct: especial.pct, monto: descuento, motivo: especial.motivo, autorizo: especial.autorizo }, { db: c });
    }
    return {
      nueva: true,
      codigo: v.rows[0].codigo,
      fecha: v.rows[0].creado_en.toISOString(),
      subtotal,
      promo: promoNombre && descuento > 0 ? { nombre: promoNombre, monto: descuento } : undefined,
      ajuste: total - neto,
      total,
      pagos: calc.pagos,
      items: prods.map((p, i) => ({ sku: p.sku, nombre: p.nombre, precio: p.precio, cant: items[i].cant, sinCambio: sinCambio[i] || undefined })),
    };
  });
}

// Arma de nuevo el ticket de una venta ya registrada (para devolverlo si el cobro se reintenta).
async function ticketDeVenta(c: PoolClient, id: number) {
  const v = await c.query<{ codigo: string; creado_en: Date; subtotal_lista: number; total: number; descuento_promo: number; promo_nombre: string | null }>(
    "select codigo, creado_en, subtotal_lista, total, descuento_promo, promo_nombre from ventas where id = $1", [id]);
  const desc = v.rows[0].descuento_promo;
  const it = await c.query<{ sku: string; nombre: string; precio: number; cant: number; sinCambio?: boolean }>(
    `select sku, nombre, precio_lista as precio, cantidad as cant, case when sin_cambio then true end as "sinCambio" from venta_items where venta_id = $1 order by id`, [id]);
  const pg = await c.query<{ medioId: string; nombre: string; pct: number; monto: number; valorLista: number; codigo: string | null }>(
    `select case when p.nota_credito_id is null then p.medio_pago_id else 'nota:' || n.codigo end as "medioId",
       case when p.nota_credito_id is null then m.nombre else 'Nota de crédito ' || n.codigo end as nombre,
       p.ajuste_pct_usado::float8 as pct, p.monto, p.valor_lista as "valorLista", n.codigo
     from venta_pagos p join medios_pago m on m.id = p.medio_pago_id left join notas_credito n on n.id = p.nota_credito_id
     where p.venta_id = $1 order by p.id`, [id]);
  return {
    codigo: v.rows[0].codigo, fecha: v.rows[0].creado_en.toISOString(), subtotal: v.rows[0].subtotal_lista,
    promo: desc > 0 ? { nombre: v.rows[0].promo_nombre ?? "Promo", monto: desc } : undefined, ajuste: v.rows[0].total - (v.rows[0].subtotal_lista - desc),
    total: v.rows[0].total, pagos: pg.rows.map((p) => ({ medioId: p.medioId, nombre: p.nombre, pct: p.pct, monto: p.monto, valorLista: p.valorLista })), items: it.rows.map((x) => ({ ...x, sinCambio: x.sinCambio ?? undefined })),
  };
}

// Ventas de una sucursal entre dos dias (hora de Argentina, ambos incluidos), de la mas vieja a la mas nueva: para encontrar la compra
// de un cliente que perdio el ticket. Solo la consulta quien puede devolver, y un local ve solo las suyas.
export async function ventasListado(sucursal: string, desde: string, hasta: string): Promise<VentaListada[]> {
  if (!esSucursal(sucursal)) falla("Sucursal inexistente");
  const fecha = /^\d{4}-\d{2}-\d{2}$/;
  if (!fecha.test(desde) || !fecha.test(hasta) || desde > hasta) falla("Fechas inválidas");
  const dias = (Date.parse(hasta) - Date.parse(desde)) / 86_400_000;
  if (!(dias >= 0 && dias <= 62)) falla("Elegí un período de hasta 2 meses");
  const r = await pool.query<{ codigo: string; fecha: Date; total: number; unidades: number; medios: string | null; devuelta: boolean; anulada: boolean; items: { nombre: string; cantidad: number }[] }>(
    `select v.codigo, v.creado_en as fecha, v.total, v.id,
       (select coalesce(sum(vi.cantidad), 0)::int from venta_items vi where vi.venta_id = v.id) as unidades,
       (select string_agg(distinct case when p.nota_credito_id is null then m.nombre else 'Nota de crédito' end, ' + ')
          from venta_pagos p join medios_pago m on m.id = p.medio_pago_id where p.venta_id = v.id) as medios,
       exists (select 1 from notas_credito n where n.venta_id = v.id) as devuelta,
       exists (select 1 from ventas_anuladas va where va.venta_id = v.id) as anulada,
       (select coalesce(json_agg(json_build_object('nombre', vi.nombre, 'cantidad', vi.cantidad) order by vi.id), '[]'::json)
          from venta_items vi where vi.venta_id = v.id) as items
     from ventas v
     where v.sucursal_id = $1
       and v.creado_en >= ($2::date::timestamp at time zone 'America/Argentina/Buenos_Aires')
       and v.creado_en <  (($3::date + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
     order by v.creado_en, v.id limit 2000`,
    [sucursal, desde, hasta],
  );
  return r.rows.map((x) => ({ codigo: x.codigo, fecha: x.fecha.toISOString(), total: x.total, unidades: x.unidades, medios: x.medios ?? "", devuelta: x.devuelta, anulada: x.anulada, items: x.items }));
}

// Ticket de una venta ya cobrada, para reimprimirlo (el cliente lo perdio o salio mal). Un local solo reimprime los suyos.
export async function ticketPorCodigo(codigo: string, soloSucursal: string | null = null) {
  const cod = codigo.trim().toUpperCase();
  if (!ES_CODIGO_VENTA.test(cod)) return falla("Código de ticket inválido");
  const v = await pool.query<{ id: number; sucursal_id: string }>("select id::int as id, sucursal_id from ventas where codigo = $1", [cod]);
  if (!v.rows[0]) return falla(`No existe la venta ${cod}`);
  if (soloSucursal && v.rows[0].sucursal_id !== soloSucursal) return falla(`Esa compra se hizo en ${nombreSucursal(v.rows[0].sucursal_id)}.`);
  if ((await pool.query("select 1 from ventas_anuladas where venta_id = $1", [v.rows[0].id])).rowCount) return falla(`La venta ${cod} fue anulada: no se reimprime.`);
  const c = await pool.connect();
  try {
    return { ...(await ticketDeVenta(c, v.rows[0].id)), sucursal: v.rows[0].sucursal_id };
  } finally {
    c.release();
  }
}

// Caja del dia de una sucursal: plata cobrada en cada medio (un pago mixto cuenta en cada medio que uso).
export async function ventasDeHoy(sucursal: string) {
  if (!esSucursal(sucursal)) falla("Sucursal inexistente");
  // Rango de hoy (hora de Argentina) para que use el indice por local y fecha.
  const hoy = `v.creado_en >= (date_trunc('day', now() at time zone 'America/Argentina/Buenos_Aires') at time zone 'America/Argentina/Buenos_Aires')`;
  const r = await pool.query<{ id: string; nombre: string; ventas: number; total: number }>(
    `select pg.medio_pago_id as id, m.nombre, count(distinct pg.venta_id)::int as ventas, coalesce(sum(pg.monto), 0)::float8 as total
     from venta_pagos pg join ventas v on v.id = pg.venta_id join medios_pago m on m.id = pg.medio_pago_id
     where v.sucursal_id = $1 and ${hoy} and ${NO_ANULADA} group by pg.medio_pago_id, m.nombre order by m.nombre`,
    [sucursal],
  );
  const n = await pool.query<{ n: number }>(`select count(*)::int as n from ventas v where v.sucursal_id = $1 and ${hoy} and ${NO_ANULADA}`, [sucursal]);
  return { filas: r.rows, ventas: n.rows[0].n };
}

export async function editar(sku: string, a: { nombre: string; precio: number }) {
  const nombre = capitalizar(a.nombre);
  if (!nombre) falla("El nombre no puede quedar vacío");
  if (!Number.isInteger(a.precio) || a.precio <= 0) falla("Ingresá un precio válido");
  try {
    const r = await pool.query(
      "update productos set nombre = $2, nombre_norm = $3, precio_lista = $4, precios_medio = case when precios_medio is null then null else (select jsonb_object_agg(k, case when k = 'efectivo' then v else to_jsonb($4::int) end) from jsonb_each(precios_medio) e(k, v)) end where sku = $1 and activo",
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
  select n.id::int as id, n.codigo, (select vv.codigo from ventas vv where vv.id = n.venta_id) as "ventaCodigo", n.sucursal_id as sucursal, n.creado_en as creada,
    n.monto_inicial as "montoInicial", n.saldo, n.ajuste_pct::float8 as "ajustePct",
    coalesce((select jsonb_agg(jsonb_build_object('nombre', vi.nombre, 'cantidad', ni.cantidad, 'monto', ni.monto, 'falladas', ni.falladas) order by ni.id)
              from nota_credito_items ni join venta_items vi on vi.id = ni.venta_item_id where ni.nota_id = n.id), '[]'::jsonb) as items
  from notas_credito n`;
type FilaNota = Omit<NotaCredito, "creada" | "estado"> & { creada: Date };
const aNota = (f: FilaNota): NotaCredito => ({
  codigo: f.codigo, ventaCodigo: f.ventaCodigo, sucursal: f.sucursal, creada: new Date(f.creada).toISOString(),
  montoInicial: f.montoInicial, saldo: f.saldo, ajustePct: f.ajustePct, items: f.items,
  estado: f.saldo <= 0 ? "usada" : "vigente",
});

export async function notaPorCodigo(codigo: string) {
  const r = await pool.query<FilaNota>(`${SELECT_NOTA} where n.codigo = $1`, [codigo.trim().toUpperCase()]);
  if (!r.rows[0]) falla(`No existe la nota de crédito ${codigo.trim().toUpperCase()}`);
  return aNota(r.rows[0]);
}

// Con que se pago una venta, en proporcion: la nota de una prenda vale lo que se pago por ella. El descuento de la promo
// (y el ajuste del medio de pago) se reparte entre todas las prendas de la compra: devolver una prenda de un 3x2 no da su precio entero.
const factorDeVenta = (v: { total: number; subtotal_lista: number }) => (v.subtotal_lista > 0 ? v.total / v.subtotal_lista : 1);
// Solo el ajuste del medio de pago (total sobre el precio despues de la promo).
const ajusteMedio = (v: { total: number; subtotal_lista: number; descuento_promo: number }) => {
  const base = v.subtotal_lista - v.descuento_promo;
  return base > 0 ? v.total / base : 1;
};

// Fecha de corte del cambio de estructura de precios (la lista pasa a ser el precio de tarjeta: lista nueva = lista vieja x factor).
// La fija el script db/cambios/precios-lista-tarjeta.sql (tabla cambios_lista, fila no revertida); si esa tabla no existe o esta
// vacia se usa empresa.cambioLista.fecha, y sin fecha no hay conversion (el sistema funciona igual que antes del cambio).
export async function corteDeLista(): Promise<{ fecha: Date; factor: number } | null> {
  try {
    const r = await pool.query<{ fecha: Date; factor: number }>(
      "select aplicado_en as fecha, factor::float8 as factor from cambios_lista where revertido_en is null order by id desc limit 1",
    );
    if (r.rows[0]) return { fecha: new Date(r.rows[0].fecha), factor: r.rows[0].factor };
  } catch {
    // La tabla todavia no existe (el cambio no se aplico): sigue con la configuracion del archivo.
  }
  const c = empresa.cambioLista;
  const fecha = c.fecha ? new Date(c.fecha) : null;
  return fecha && !Number.isNaN(fecha.getTime()) && c.factor > 0 ? { fecha, factor: c.factor } : null;
}

// Porcentaje que lleva la nota de credito (solo el del medio de pago, sin la promo), en %. Una venta anterior al corte se pago contra
// la lista VIEJA: su porcentaje se divide por el factor para que la nota cubra la misma prenda al usarla con la lista nueva.
export function ajusteDeNota(v: { total: number; subtotal_lista: number; descuento_promo: number }, creadoEn: Date, corte: { fecha: Date; factor: number } | null) {
  const k = ajusteMedio(v) / (corte && creadoEn < corte.fecha ? corte.factor : 1);
  return Math.round((k - 1) * 1_000_000) / 10_000;
}

// Busca una venta por el codigo de su ticket (V000123, o solo el numero) para devolver prendas.
export async function ventaParaDevolucion(codigo: string, soloSucursal: string | null = null): Promise<VentaDevolvible> {
  // Solo por el codigo del ticket (no por numero interno): asi nadie puede recorrer las ventas probando numeros.
  const cod = codigo.trim().toUpperCase();
  if (!ES_CODIGO_VENTA.test(cod)) return falla("Escaneá el código de barras del ticket de venta (empieza con V).");
  const v = await pool.query<{ id: number; codigo: string; creado_en: Date; sucursal_id: string; total: number; subtotal_lista: number; descuento_promo: number }>(
    "select id::int as id, codigo, creado_en, sucursal_id, total, subtotal_lista, descuento_promo from ventas where codigo = $1", [cod],
  );
  const venta = v.rows[0];
  if (!venta) return falla(`No existe la venta ${cod}`);
  if ((await pool.query("select 1 from ventas_anuladas where venta_id = $1", [venta.id])).rowCount) return falla(`La venta ${cod} fue anulada: no se puede devolver`);
  if (soloSucursal && venta.sucursal_id !== soloSucursal) {
    return falla(`Esa compra se hizo en ${nombreSucursal(venta.sucursal_id)}: la devolución se hace en ese local.`);
  }
  if (Date.now() - venta.creado_en.getTime() > DIAS_DEVOLUCION * 86_400_000) {
    return falla(`Esa compra es del ${venta.creado_en.toLocaleDateString("es-AR")}: pasaron más de ${DIAS_DEVOLUCION} días y ya no se acepta la devolución`);
  }
  const f = factorDeVenta(venta);
  const it = await pool.query<{ id: number; sku: string; nombre: string; precio: number; vendidas: number; devueltas: number; sinCambio: boolean }>(
    `select vi.id::int as id, vi.sku, vi.nombre, vi.precio_lista as precio, vi.cantidad as vendidas, vi.sin_cambio as "sinCambio",
       coalesce((select sum(ni.cantidad) from nota_credito_items ni where ni.venta_item_id = vi.id), 0)::int as devueltas
     from venta_items vi where vi.venta_id = $1 order by vi.id`, [venta.id],
  );
  return {
    codigo: venta.codigo, fecha: venta.creado_en.toISOString(), sucursal: venta.sucursal_id, total: venta.total,
    items: it.rows.map((x) => ({ ...x, valor: Math.round(x.precio * f) })),
  };
}

// Anula una venta (ticket equivocado): el stock vuelve de donde salio y la venta deja de contar en caja, cierre e informes.
// La venta NO se borra ni se edita: queda registrada junto con el motivo y quien la anulo (la anulacion tampoco se deshace; si fue
// un error, se vuelve a vender). Los locales solo anulan ventas de HOY y de su propio local; la oficina (admin) puede anular dias
// anteriores. Nunca se anula si ya se cerro la caja de ese dia, si hubo devoluciones, o si se pago con una nota de credito
// (para esos casos corresponde una devolucion o hablar con la oficina).
export async function anularVenta(ventaCodigo: string, motivoPedido: string, o: { soloSucursal: string | null; admin: boolean }) {
  const cod = String(ventaCodigo).trim().toUpperCase();
  if (!ES_CODIGO_VENTA.test(cod)) falla("Escaneá o escribí el código del ticket de venta (empieza con V).");
  const motivo = String(motivoPedido ?? "").trim().replace(/\s+/g, " ");
  if (motivo.length < 5 || motivo.length > 200) falla("Escribí el motivo de la anulación (de 5 a 200 letras).");
  const TZ = "America/Argentina/Buenos_Aires";
  return tx(async (c) => {
    // Mismo candado que las devoluciones: anular y devolver la misma compra a la vez se hacen una despues de la otra.
    await c.query("select pg_advisory_xact_lock(hashtext($1))", [`devolucion:${cod}`]);
    const v = await c.query<{ id: number; sucursal_id: string; total: number; dia: string; es_hoy: boolean; muy_vieja: boolean }>(
      `select id::int as id, sucursal_id, total, (creado_en at time zone '${TZ}')::date::text as dia,
         (creado_en at time zone '${TZ}')::date = (now() at time zone '${TZ}')::date as es_hoy,
         creado_en < now() - interval '${DIAS_DEVOLUCION} days' as muy_vieja
       from ventas where codigo = $1`, [cod]);
    const venta = v.rows[0];
    if (!venta) return falla(`No existe la venta ${cod}`);
    // Mismo candado que usa cerrarCaja para ese local y dia: anular y cerrar la caja no pasan a la vez.
    await c.query("select pg_advisory_xact_lock(hashtext($1))", [`caja:${venta.sucursal_id}:${venta.dia}`]);
    if (o.soloSucursal && venta.sucursal_id !== o.soloSucursal) return falla(`Esa compra se hizo en ${nombreSucursal(venta.sucursal_id)}: se anula en ese local.`);
    if (!o.admin && !venta.es_hoy) return falla("Solo se pueden anular ventas de hoy. Para una anterior, consultá a la oficina.");
    if (venta.muy_vieja) return falla(`Pasaron más de ${DIAS_DEVOLUCION} días desde esa venta: ya no se puede anular.`);
    if ((await c.query("select 1 from ventas_anuladas where venta_id = $1", [venta.id])).rowCount) return falla(`La venta ${cod} ya estaba anulada.`);
    if ((await c.query("select 1 from notas_credito where venta_id = $1", [venta.id])).rowCount) return falla("Esa venta ya tiene una devolución (nota de crédito): no se puede anular.");
    if ((await c.query("select 1 from venta_pagos where venta_id = $1 and nota_credito_id is not null", [venta.id])).rowCount) {
      return falla("Esa venta se pagó con una nota de crédito: no se puede anular desde acá. Consultá a la oficina.");
    }
    if ((await c.query("select 1 from cierres_caja where sucursal_id = $1 and dia = $2::date", [venta.sucursal_id, venta.dia])).rowCount) {
      return falla(`La caja de ${nombreSucursal(venta.sucursal_id)} del ${venta.dia.split("-").reverse().join("/")} ya está cerrada: esa venta no se puede anular.`);
    }
    const it = await c.query<{ sku: string; cantidad: number; stock_de: string | null }>(
      "select sku, cantidad, stock_de from venta_items where venta_id = $1 order by sku, id", [venta.id]);
    await c.query("insert into ventas_anuladas (venta_id, usuario_id, motivo) values ($1, $2, $3)", [venta.id, usuarioEnCurso()?.id ?? null, motivo]);
    let unidades = 0;
    for (const x of it.rows) {
      const destino = x.stock_de ?? venta.sucursal_id;
      await sumarStock(c, x.sku, destino, x.cantidad);
      await mov(c, x.sku, x.cantidad, null, destino, "anulacion", { ventaId: venta.id, motivo: `Venta ${cod} anulada: ${motivo}` });
      unidades += x.cantidad;
    }
    await auditar("venta_anulada", { venta: cod, sucursal: venta.sucursal_id, total: venta.total, unidades, motivo }, { db: c });
    return { codigo: cod, total: venta.total, unidades };
  });
}

// Emite una nota de credito: devuelve las prendas elegidas al stock de la sucursal y deja un saldo a favor por 15 dias.
// `falladas` = unidades del renglon que estan falladas: esas dan igual la nota, pero NO vuelven al stock.
export async function emitirNota(sucursal: string, ventaCodigo: string, items: { itemId: number; cant: number; falladas: number }[], soloSucursal: string | null = null) {
  if (!esSucursal(sucursal)) falla("Sucursal inexistente");
  const pedidos = items.filter((i) => i.cant > 0).sort((a, b) => a.itemId - b.itemId);
  if (pedidos.length === 0) falla("Elegí al menos una prenda para devolver");
  for (const i of pedidos) {
    if (!Number.isInteger(i.cant) || !Number.isInteger(i.itemId) || !Number.isInteger(i.falladas) || i.falladas < 0 || i.falladas > i.cant) falla("Cantidad inválida");
  }
  const corte = await corteDeLista();
  return tx(async (c) => {
    const codigoVenta = String(ventaCodigo).trim().toUpperCase();
    // Dos devoluciones de la misma compra a la vez se hacen una despues de la otra. Se usa un candado por codigo y no
    // "for update" sobre ventas, porque la aplicacion no tiene (ni debe tener) permiso de modificar la tabla de ventas.
    await c.query("select pg_advisory_xact_lock(hashtext($1))", [`devolucion:${codigoVenta}`]);
    const v = await c.query<{ id: number; total: number; subtotal_lista: number; descuento_promo: number; fuera: boolean; sucursal_id: string; creado_en: Date }>(
      `select id::int as id, total, subtotal_lista, descuento_promo, sucursal_id, creado_en, creado_en < now() - interval '${DIAS_DEVOLUCION} days' as fuera
       from ventas where codigo = $1`, [codigoVenta],
    );
    if (!v.rows[0]) return falla("No existe esa venta");
    const ventaId = v.rows[0].id;
    if ((await c.query("select 1 from ventas_anuladas where venta_id = $1", [ventaId])).rowCount) return falla("Esa venta fue anulada: no se puede devolver");
    // Un local solo devuelve compras de su propio local: si no, se podria "crear" stock y vales con ventas ajenas.
    if (soloSucursal && v.rows[0].sucursal_id !== soloSucursal) return falla(`Esa compra se hizo en ${nombreSucursal(v.rows[0].sucursal_id)}: la devolución se hace en ese local.`);
    if (v.rows[0].fuera) return falla(`Pasaron más de ${DIAS_DEVOLUCION} días desde la compra: ya no se acepta la devolución`);
    const f = factorDeVenta(v.rows[0]);
    const vi = await c.query<{ id: number; sku: string; nombre: string; precio: number; vendidas: number; devueltas: number; sin_cambio: boolean; stock_de: string | null }>(
      `select vi.id::int as id, vi.sku, vi.nombre, vi.precio_lista as precio, vi.cantidad as vendidas, vi.sin_cambio, vi.stock_de,
         coalesce((select sum(ni.cantidad) from nota_credito_items ni where ni.venta_item_id = vi.id), 0)::int as devueltas
       from venta_items vi where vi.venta_id = $1`, [ventaId],
    );
    const filas: { item: (typeof vi.rows)[number]; cant: number; falladas: number; monto: number }[] = [];
    for (const p of pedidos) {
      const item = vi.rows.find((x) => x.id === p.itemId);
      if (!item) return falla("Una de las prendas no pertenece a esa venta");
      if (item.sin_cambio) return falla(`${item.nombre} se vendió en una promo SIN CAMBIO: no se acepta la devolución`);
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
      // El porcentaje de la nota es SOLO el del medio de pago (sin la promo): si no, al usarla en otra compra con promo,
      // el cliente aprovecharia la promo dos veces. Si la venta es anterior al cambio de lista, se convierte (ver ajusteDeNota).
      [ventaId, sucursal, monto, ajusteDeNota(v.rows[0], v.rows[0].creado_en, corte), usuarioEnCurso()?.id ?? null],
    );
    for (const x of filas) {
      await c.query(
        "insert into nota_credito_items (nota_id, venta_item_id, sku, cantidad, falladas, monto) values ($1, $2, $3, $4, $5, $6)",
        [n.rows[0].id, x.item.id, x.item.sku, x.cant, x.falladas, x.monto],
      );
      // Las falladas no vuelven al stock: solo se reponen las que estan bien.
      const buenas = x.cant - x.falladas;
      if (buenas > 0) {
        // Vuelve al stock de donde salio (una venta del deposito con ropa de San Lorenzo devuelve a San Lorenzo).
        // (Solo si la devolucion se hace en el mismo local de la venta; si la oficina la hace en otro local, la prenda vuelve a ese local.)
        const destinoStock = sucursal === v.rows[0].sucursal_id ? x.item.stock_de ?? sucursal : sucursal;
        await sumarStock(c, x.item.sku, destinoStock, buenas);
        await mov(c, x.item.sku, buenas, null, destinoStock, "devolucion", { ventaId, motivo: `Nota de crédito ${n.rows[0].codigo}` });
      }
    }
    const r = await c.query<FilaNota>(`${SELECT_NOTA} where n.id = $1`, [n.rows[0].id]);
    return aNota(r.rows[0]);
  });
}

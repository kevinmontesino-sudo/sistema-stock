import type { PoolClient } from "pg";
import { pool, tx, type Db } from "./db";
import { DEPOSITO, empresa } from "./empresa.config";
import { ErrorNegocio } from "./repo";

// Cuentas de clientes mayoristas del Deposito (venta a cuenta / fiado). Ver PLAN_CUENTAS_MAYORISTAS.md.
// - Cada cliente es del vendedor que le vende (Santiago, Mayra, Tomas). Ese vendedor comisiona el % de lo que el cliente PAGA (cuando entra la plata).
// - La deuda se lleva en VALOR DE LISTA (ya con Curva Plus): un pago en cualquier medio la baja por su equivalente en lista (efectivo -20%, etc.).
// - Los movimientos no se editan ni se borran: el saldo es siempre la suma de movimientos (las cuentas siempre cierran).
const MEDIOS_CUENTA = ["efectivo", "transferencia"] as const; // la venta a cuenta se acuerda en uno de estos dos (tarjeta no)
const falla: (m: string) => never = (m) => { throw new ErrorNegocio(m); };
const txt = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const TZ = "America/Argentina/Buenos_Aires";

export type Cliente = {
  id: number; nombre: string; telefono: string | null; nota: string | null; vendedorId: number; vendedor: string; nivelPrecio: "curva_plus" | "lista";
  limite: number | null; activo: boolean; saldo: number; equivalentes: Record<string, number>; compras: number; ultimaCompra: string | null; ultimoPago: string | null;
  diasSinPagar: number | null; superaLimite: boolean;
};

async function pctsMedios(db: Db) {
  const r = await db.query<{ id: string; pct: number }>("select id, ajuste_pct::float8 as pct from medios_pago where id in ('efectivo', 'transferencia')");
  return Object.fromEntries(r.rows.map((x) => [x.id, x.pct])) as Record<string, number>;
}
// Lo que equivale una deuda (en valor de lista) pagando en cada medio.
const equivalentes = (saldo: number, pcts: Record<string, number>) => Object.fromEntries(MEDIOS_CUENTA.map((m) => [m, Math.round(saldo * (1 + (pcts[m] ?? 0) / 100))]));

export async function saldoDe(db: Db, clienteId: number) {
  return (await db.query<{ s: number }>("select coalesce(sum(valor_lista), 0)::int as s from cuenta_movimientos where cliente_id = $1", [clienteId])).rows[0].s;
}

// ---- Clientes ----
export async function listarClientes(): Promise<Cliente[]> {
  const pcts = await pctsMedios(pool);
  const r = await pool.query<{
    id: number; nombre: string; telefono: string | null; nota: string | null; vendedor_id: number; vendedor: string; nivel_precio: "curva_plus" | "lista"; limite: number | null; activo: boolean;
    saldo: number; compras: number; ultima_compra: Date | null; ultimo_pago: Date | null; primera: Date | null;
  }>(
    `select c.id::int, c.nombre, c.telefono, c.nota, c.vendedor_id::int, v.nombre as vendedor, c.nivel_precio, c.limite, c.activo,
       coalesce(m.saldo, 0)::int as saldo, coalesce(m.compras, 0)::int as compras, m.ultima_compra, m.ultimo_pago, m.primera
     from clientes_mayoristas c join vendedores v on v.id = c.vendedor_id
     left join (select cliente_id, sum(valor_lista) as saldo, count(*) filter (where tipo = 'venta') as compras,
                  max(creado_en) filter (where tipo = 'venta') as ultima_compra, max(creado_en) filter (where tipo = 'pago') as ultimo_pago,
                  min(creado_en) filter (where tipo in ('venta', 'ajuste') and valor_lista > 0) as primera
                from cuenta_movimientos group by cliente_id) m on m.cliente_id = c.id
     order by lower(v.nombre), lower(c.nombre)`);
  const ahora = Date.now();
  return r.rows.map((x) => {
    const base = x.ultimo_pago ?? x.primera;
    return {
      id: x.id, nombre: x.nombre, telefono: x.telefono, nota: x.nota, vendedorId: x.vendedor_id, vendedor: x.vendedor, nivelPrecio: x.nivel_precio, limite: x.limite, activo: x.activo,
      saldo: x.saldo, equivalentes: equivalentes(x.saldo, pcts), compras: x.compras, ultimaCompra: x.ultima_compra?.toISOString() ?? null, ultimoPago: x.ultimo_pago?.toISOString() ?? null,
      diasSinPagar: x.saldo > 0 && base ? Math.floor((ahora - base.getTime()) / 86_400_000) : null, superaLimite: x.limite !== null && x.saldo > x.limite,
    };
  });
}

// Vendedores del Deposito que pueden ser duenos de clientes (los de la lista de vendedores del Deposito).
export async function vendedoresDeposito() {
  const r = await pool.query<{ id: number; nombre: string }>("select id::int, nombre from vendedores where sucursal_id = $1 and activo order by lower(nombre)", [DEPOSITO]);
  return r.rows;
}

export type DatosCliente = { nombre: unknown; telefono?: unknown; nota?: unknown; vendedorId: unknown; limite?: unknown; nivelPrecio?: unknown };
export async function crearCliente(d: DatosCliente, usuario: { id: number; nombre: string }) {
  const nombre = txt(d.nombre, 80);
  if (nombre.length < 2) falla("Poné el nombre del cliente.");
  const vendedorId = Number(d.vendedorId);
  const v = Number.isInteger(vendedorId) ? (await pool.query("select 1 from vendedores where id = $1 and activo and sucursal_id = $2", [vendedorId, DEPOSITO])).rowCount : 0;
  if (!v) falla("Elegí el vendedor dueño del cliente (de los del Depósito).");
  const limite = d.limite === undefined || d.limite === null || d.limite === "" ? null : Number(d.limite);
  if (limite !== null && (!Number.isInteger(limite) || limite < 0 || limite > 2_000_000_000)) falla("El límite de deuda tiene que ser un número entero (o dejarlo vacío para sin límite).");
  const nivel = d.nivelPrecio === "lista" ? "lista" : "curva_plus";
  try {
    const r = await pool.query<{ id: number }>(
      `insert into clientes_mayoristas (nombre, telefono, nota, vendedor_id, nivel_precio, limite, creado_por, usuario_id) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id::int as id`,
      [nombre, txt(d.telefono, 40) || null, txt(d.nota, 300) || null, vendedorId, nivel, limite, usuario.nombre, usuario.id]);
    return { id: r.rows[0].id };
  } catch (e) {
    if ((e as { code?: string }).code === "23505") falla("Ya hay un cliente con ese nombre.");
    throw e;
  }
}

// Cambios del cliente. Cambiar de vendedor (dueno) y reactivar/desactivar los hace un admin (se pide motivo y queda en la auditoria).
export async function editarCliente(id: number, d: { telefono?: unknown; nota?: unknown; limite?: unknown; nivelPrecio?: unknown; activo?: unknown; vendedorId?: unknown }) {
  const c = (await pool.query<{ vendedor_id: number }>("select vendedor_id::int from clientes_mayoristas where id = $1", [id])).rows[0];
  if (!c) falla("No existe ese cliente.");
  const sets: string[] = []; const vals: unknown[] = [id];
  const poner = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (d.telefono !== undefined) poner("telefono", txt(d.telefono, 40) || null);
  if (d.nota !== undefined) poner("nota", txt(d.nota, 300) || null);
  if (d.limite !== undefined) {
    const l = d.limite === null || d.limite === "" ? null : Number(d.limite);
    if (l !== null && (!Number.isInteger(l) || l < 0 || l > 2_000_000_000)) falla("El límite de deuda tiene que ser un número entero (o vacío para sin límite).");
    poner("limite", l);
  }
  if (d.nivelPrecio !== undefined) poner("nivel_precio", d.nivelPrecio === "lista" ? "lista" : "curva_plus");
  if (typeof d.activo === "boolean") poner("activo", d.activo);
  if (d.vendedorId !== undefined) {
    const vid = Number(d.vendedorId);
    if (!Number.isInteger(vid) || !(await pool.query("select 1 from vendedores where id = $1 and activo and sucursal_id = $2", [vid, DEPOSITO])).rowCount) falla("Elegí un vendedor del Depósito.");
    poner("vendedor_id", vid);
  }
  if (!sets.length) return { cambiado: false, vendedorAnterior: c.vendedor_id };
  await pool.query(`update clientes_mayoristas set ${sets.join(", ")} where id = $1`, vals);
  return { cambiado: true, vendedorAnterior: c.vendedor_id };
}

// ---- Estado de cuenta ----
export async function estadoDeCuenta(clienteId: number, limite = 200) {
  const cl = (await listarClientes()).find((x) => x.id === clienteId);
  if (!cl) falla("No existe ese cliente.");
  const r = await pool.query<{ id: number; creado: Date; tipo: string; valor_lista: number; monto: number; medio: string | null; venta: string | null; comision: number; motivo: string | null; autorizo: string | null; registrado_por: string }>(
    `select x.id::int, x.creado_en as creado, x.tipo, x.valor_lista, x.monto, x.medio_id as medio, v.codigo as venta, x.comision, x.motivo, x.autorizo, x.registrado_por
     from cuenta_movimientos x left join ventas v on v.id = x.venta_id where x.cliente_id = $1 order by x.creado_en desc, x.id desc limit $2`, [clienteId, Math.min(Math.max(limite, 1), 500)]);
  return {
    cliente: cl,
    movimientos: r.rows.map((x) => ({ id: x.id, fecha: x.creado.toISOString(), tipo: x.tipo, valorLista: x.valor_lista, monto: x.monto, medio: x.medio, venta: x.venta, comision: x.comision, motivo: x.motivo, autorizo: x.autorizo, registradoPor: x.registrado_por })),
  };
}

// ---- Pagos del cliente (entra plata) ----
// El pago baja la deuda por su equivalente en valor de lista (efectivo -20%: $6.000 cubren $7.500 de lista). Si paga mas de lo que debe, se rechaza.
// El vendedor dueno del cliente comisiona el % de lo que entro (comisionMayorista.pct). El efectivo y la transferencia entran a la caja del dia del Deposito.
export async function registrarPago(clienteId: number, medio: string, montoPedido: number, usuario: { id: number; nombre: string }, motivo = "") {
  if (!(MEDIOS_CUENTA as readonly string[]).includes(medio)) falla("El pago es en efectivo o en transferencia.");
  if (!Number.isInteger(montoPedido) || montoPedido < 1 || montoPedido > 2_000_000_000) falla("El monto tiene que ser un número entero mayor a 0.");
  const mot = txt(motivo, 200);
  return tx(async (c) => {
    const cl = (await c.query<{ vendedor_id: number; activo: boolean; nombre: string }>("select vendedor_id::int, activo, nombre from clientes_mayoristas where id = $1 for update", [clienteId])).rows[0];
    if (!cl) return falla("No existe ese cliente.");
    const saldo = await saldoDe(c, clienteId);
    if (saldo <= 0) return falla(`${cl.nombre} no debe nada.`);
    const pcts = await pctsMedios(c);
    const f = 1 + (pcts[medio] ?? 0) / 100;
    let vl = Math.round(montoPedido / f);
    if (vl > saldo + 1) {
      const maximo = Math.round(saldo * f);
      return falla(`Está pagando más de lo que debe: la deuda de ${cl.nombre} es $ ${maximo.toLocaleString("es-AR")} en ${medio}.`);
    }
    if (vl > saldo) vl = saldo;
    if (vl < 1) return falla("El monto es muy chico.");
    const pctCom = empresa.comisionMayorista.pct;
    const comision = Math.round((montoPedido * pctCom) / 100);
    const r = await c.query<{ id: number }>(
      `insert into cuenta_movimientos (cliente_id, tipo, valor_lista, monto, medio_id, sucursal_id, vendedor_id, comision, comision_pct, motivo, registrado_por, usuario_id)
       values ($1, 'pago', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id::int as id`,
      [clienteId, -vl, montoPedido, medio, DEPOSITO, cl.vendedor_id, comision, pctCom, mot || null, usuario.nombre, usuario.id]);
    return { id: r.rows[0].id, saldo: saldo - vl, valorLista: vl, comision, cliente: cl.nombre };
  });
}

// Ajuste de un administrador (con motivo): + suma deuda (por ejemplo para cargar la deuda de hoy al empezar), - la baja. No comisiona.
export async function ajustarCuenta(clienteId: number, valorLista: number, motivo: string, usuario: { id: number; nombre: string }) {
  if (!Number.isInteger(valorLista) || valorLista === 0 || Math.abs(valorLista) > 2_000_000_000) falla("El ajuste tiene que ser un número entero distinto de 0 (positivo = suma deuda).");
  const mot = txt(motivo, 200);
  if (mot.length < 5) falla("Escribí el motivo del ajuste (5 letras o más).");
  return tx(async (c) => {
    const cl = (await c.query<{ vendedor_id: number }>("select vendedor_id::int from clientes_mayoristas where id = $1 for update", [clienteId])).rows[0];
    if (!cl) return falla("No existe ese cliente.");
    const saldo = await saldoDe(c, clienteId);
    if (saldo + valorLista < 0) return falla("El ajuste dejaría la cuenta a favor del cliente. No se admite saldo a favor.");
    const r = await c.query<{ id: number }>(
      `insert into cuenta_movimientos (cliente_id, tipo, valor_lista, monto, sucursal_id, vendedor_id, motivo, registrado_por, usuario_id)
       values ($1, 'ajuste', $2, 0, $3, $4, $5, $6, $7) returning id::int as id`, [clienteId, valorLista, DEPOSITO, cl.vendedor_id, mot, usuario.nombre, usuario.id]);
    return { id: r.rows[0].id, saldo: saldo + valorLista };
  });
}

// ---- Ganchos de la venta a cuenta (los usa repo.registrarVenta dentro de su transaccion) ----
export async function prepararVentaACuenta(c: PoolClient, sucursal: string, clienteId: number, medio: string) {
  if (sucursal !== DEPOSITO) falla("La venta a cuenta solo se hace en la caja del Depósito.");
  if (!(MEDIOS_CUENTA as readonly string[]).includes(medio)) falla("La venta a cuenta se acuerda en efectivo o en transferencia.");
  const cl = (await c.query<{ id: number; nombre: string; vendedor_id: number; activo: boolean; limite: number | null }>(
    "select id::int, nombre, vendedor_id::int, activo, limite from clientes_mayoristas where id = $1 for update", [clienteId])).rows[0];
  if (!cl) return falla("No existe ese cliente mayorista.");
  if (!cl.activo) return falla(`${cl.nombre} está dado de baja: no se le puede vender a cuenta.`);
  return { ...cl, saldo: await saldoDe(c, clienteId) };
}

// Anota la venta en la cuenta. Si supera el limite de deuda, hace falta que alguien lo autorice (queda su nombre).
export async function anotarVentaACuenta(c: PoolClient, d: {
  cliente: { id: number; nombre: string; vendedor_id: number; limite: number | null; saldo: number }; ventaId: number; valorLista: number; monto: number; medio: string; autorizo?: string; usuario: { id: number | null; nombre: string };
}) {
  if (d.valorLista < 1) falla("La venta a cuenta no puede ser de $0.");
  const autorizo = txt(d.autorizo, 80);
  const supera = d.cliente.limite !== null && d.cliente.saldo + d.valorLista > d.cliente.limite;
  if (supera && autorizo.length < 2) {
    falla(`${d.cliente.nombre} se pasa del límite de deuda ($ ${d.cliente.limite!.toLocaleString("es-AR")}; debe $ ${d.cliente.saldo.toLocaleString("es-AR")} y esta compra suma $ ${d.valorLista.toLocaleString("es-AR")} de lista). Pedí la autorización de su vendedor o de Tomás y anotala.`);
  }
  await c.query(
    `insert into cuenta_movimientos (cliente_id, tipo, valor_lista, monto, medio_id, sucursal_id, venta_id, vendedor_id, autorizo, motivo, registrado_por, usuario_id)
     values ($1, 'venta', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [d.cliente.id, d.valorLista, d.monto, d.medio, DEPOSITO, d.ventaId, d.cliente.vendedor_id, supera ? autorizo : null, supera ? "Superó el límite de deuda" : null, d.usuario.nombre, d.usuario.id]);
  return { superoLimite: supera };
}

// Si se anula una venta a cuenta, se saca de la deuda (movimiento nuevo; el original no se toca).
export async function anotarAnulacion(c: PoolClient, ventaId: number, motivo: string, usuario: { id: number | null; nombre: string }) {
  const m = (await c.query<{ cliente_id: number; vendedor_id: number; valor: number }>(
    "select cliente_id::int, max(vendedor_id)::int as vendedor_id, coalesce(sum(valor_lista), 0)::int as valor from cuenta_movimientos where venta_id = $1 and tipo = 'venta' group by cliente_id", [ventaId])).rows[0];
  if (!m || m.valor <= 0) return;
  await c.query("select 1 from clientes_mayoristas where id = $1 for update", [m.cliente_id]);
  if ((await saldoDe(c, m.cliente_id)) - m.valor < 0) {
    falla("No se puede anular esta venta a cuenta: el cliente ya pagó más de lo que quedaría de deuda. Pedí a la oficina un ajuste de la cuenta.");
  }
  await c.query(
    `insert into cuenta_movimientos (cliente_id, tipo, valor_lista, monto, sucursal_id, venta_id, vendedor_id, motivo, registrado_por, usuario_id)
     values ($1, 'anulacion', $2, 0, $3, $4, $5, $6, $7, $8)`, [m.cliente_id, -m.valor, DEPOSITO, ventaId, m.vendedor_id, txt(`Venta anulada: ${motivo}`, 200), usuario.nombre, usuario.id]);
}

// ---- Cobros de clientes que entran a la caja del dia (el efectivo y la transferencia del cierre del Deposito) ----
export async function cobrosCuentasDelDia(sucursal: string, dia: string) {
  if (sucursal !== DEPOSITO || !FECHA.test(dia)) return [] as { id: string; nombre: string; monto: number }[];
  const r = await pool.query<{ id: string; nombre: string; monto: number }>(
    `select x.medio_id as id, m.nombre, sum(x.monto)::float8 as monto from cuenta_movimientos x join medios_pago m on m.id = x.medio_id
     where x.tipo = 'pago' and x.sucursal_id = $1 and x.creado_en >= ($2::date)::timestamp at time zone '${TZ}' and x.creado_en < ($2::date + 1)::timestamp at time zone '${TZ}'
     group by 1, 2 order by m.nombre`, [sucursal, dia]);
  return r.rows;
}

// ---- Comisiones de los mayoristas por mes (lo cobrado de sus clientes, pct de empresa.config) ----
export async function comisionesMayoristas(mes?: string | null) {
  const hoy = (await pool.query<{ m: string }>(`select to_char(now() at time zone '${TZ}', 'YYYY-MM') as m`)).rows[0].m;
  const m = mes && /^\d{4}-\d{2}$/.test(mes) ? mes : hoy;
  const r = await pool.query<{ vid: number; vendedor: string; cid: number; cliente: string; cobrado: number; comision: number; pagos: number }>(
    `select x.vendedor_id::int as vid, v.nombre as vendedor, x.cliente_id::int as cid, c.nombre as cliente, sum(x.monto)::float8 as cobrado, sum(x.comision)::float8 as comision, count(*)::int as pagos
     from cuenta_movimientos x join vendedores v on v.id = x.vendedor_id join clientes_mayoristas c on c.id = x.cliente_id
     where x.tipo = 'pago' and to_char(x.creado_en at time zone '${TZ}', 'YYYY-MM') = $1 group by 1, 2, 3, 4 order by lower(v.nombre), lower(c.nombre)`, [m]);
  const por = new Map<number, { vendedorId: number; vendedor: string; cobrado: number; comision: number; clientes: { clienteId: number; cliente: string; cobrado: number; comision: number; pagos: number }[] }>();
  for (const x of r.rows) {
    const v = por.get(x.vid) ?? { vendedorId: x.vid, vendedor: x.vendedor, cobrado: 0, comision: 0, clientes: [] };
    v.cobrado += x.cobrado; v.comision += x.comision; v.clientes.push({ clienteId: x.cid, cliente: x.cliente, cobrado: x.cobrado, comision: x.comision, pagos: x.pagos });
    por.set(x.vid, v);
  }
  const lista = [...por.values()];
  return { mes: m, porcentaje: empresa.comisionMayorista.pct, porVendedor: lista, totalCobrado: lista.reduce((s, v) => s + v.cobrado, 0), totalComision: lista.reduce((s, v) => s + v.comision, 0) };
}

// ---- Informe para la oficina / MCP (solo lectura) ----
export async function informeCuentas() {
  const clientes = await listarClientes();
  const porVendedor = new Map<number, { vendedorId: number; vendedor: string; deudaLista: number; clientes: number; conDeuda: number }>();
  for (const c of clientes.filter((x) => x.activo)) {
    const v = porVendedor.get(c.vendedorId) ?? { vendedorId: c.vendedorId, vendedor: c.vendedor, deudaLista: 0, clientes: 0, conDeuda: 0 };
    v.deudaLista += c.saldo; v.clientes += 1; if (c.saldo > 0) v.conDeuda += 1;
    porVendedor.set(c.vendedorId, v);
  }
  return {
    nota: "Deuda en valor de lista (ya con Curva Plus). 'equivalentes' = lo que equivale pagando en cada medio. Sin plazo de pago: se mira la antigüedad (diasSinPagar).",
    deudaTotalLista: clientes.reduce((s, c) => s + c.saldo, 0),
    porVendedor: [...porVendedor.values()],
    clientes: clientes.filter((c) => c.saldo > 0 || c.activo).map((c) => ({ id: c.id, cliente: c.nombre, vendedor: c.vendedor, deudaLista: c.saldo, equivalentes: c.equivalentes, limite: c.limite, superaLimite: c.superaLimite, diasSinPagar: c.diasSinPagar, ultimaCompra: c.ultimaCompra, ultimoPago: c.ultimoPago })),
    comisionesDelMes: await comisionesMayoristas(null),
  };
}

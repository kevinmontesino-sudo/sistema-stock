// PRUEBAS AUTOMATICAS de punta a punta contra la COPIA DE PRUEBAS (sistema_stock_staging).
// Usa las mismas funciones que el sistema (lib/repo.ts, lib/promosAdmin.ts, lib/informes.ts) con los datos reales copiados:
// carga prendas "ZZ Prueba ...", las envia a White y las recibe, vende con cada medio de pago, con promos (3x2 y precio),
// con descuento especial, devuelve, paga con nota de credito, reimprime tickets y controla que informes y totales cierren.
// Deja prendas y ventas "ZZ" en la copia: despues correr `npm run staging:refrescar` para volver a tenerla igual a la real.
// Uso: npm run staging:probar   (sale con codigo 1 si algo da MAL)
import pg from "pg";

// ---- Guarda: solo contra la copia de pruebas local. Se controla ANTES de cargar el sistema (que abre la conexion). ----
const url = process.env.DATABASE_URL ?? "";
const u = (() => { try { return new URL(url); } catch { return null; } })();
if (!u || u.hostname !== "127.0.0.1" || (u.port || "5432") !== "5432" || u.pathname !== "/sistema_stock_staging") {
  console.error("Me niego: estas pruebas solo se corren contra la copia de pruebas local (127.0.0.1:5432/sistema_stock_staging).");
  process.exit(1);
}
{
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  const r = await c.query<{ db: string; port: string }>("select current_database() as db, current_setting('port') as port");
  await c.end();
  if (r.rows[0].db !== "sistema_stock_staging" || r.rows[0].port !== "5432") {
    console.error("Me niego: la conexion no quedo en la copia de pruebas.");
    process.exit(1);
  }
}

const repo = await import("../lib/repo");
const promosAdmin = await import("../lib/promosAdmin");
const inf = await import("../lib/informes");
const { montoNotaAplicable, preciosDe, textoPrecioEtiqueta } = await import("../lib/util");
const { etiquetaTspl } = await import("../lib/tspl");
const { etiquetasPdf } = await import("../lib/etiquetaPdf");
const { lineasTicket } = await import("../lib/ticketLineas");
const { mediosParaPromo } = await import("../lib/promos");
const { empresa } = await import("../lib/empresa.config");
const { pool } = await import("../lib/db");

type Fila = { prueba: string; ok: boolean; detalle: string };
const filas: Fila[] = [];
const check = (prueba: string, ok: boolean, detalle = "") => { filas.push({ prueba, ok, detalle }); };
const igual = (prueba: string, real: unknown, esperado: unknown) =>
  check(prueba, JSON.stringify(real) === JSON.stringify(esperado), `dio ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`);
async function paso(nombre: string, fn: () => Promise<void>) {
  try { await fn(); } catch (e) { check(nombre, false, `ERROR: ${(e as Error).message}`); }
}
async function debeFallar(prueba: string, fn: () => Promise<unknown>, texto: RegExp) {
  try { await fn(); check(prueba, false, "no dio error y tenia que darlo"); }
  catch (e) { const m = (e as Error).message; check(prueba, e instanceof repo.ErrorNegocio && texto.test(m), m); }
}

const LOCAL = "white";
const stockDe = async (sku: string, suc: string) =>
  (await pool.query<{ n: number }>("select coalesce(sum(cantidad), 0)::int as n from stock where sku = $1 and sucursal_id = $2", [sku, suc])).rows[0].n;
const pagosEnBase = async (codigo: string) =>
  (await pool.query<{ suma: number; total: number; n: number }>(
    `select coalesce(sum(p.monto), 0)::int as suma, max(v.total)::int as total, count(p.id)::int as n
     from ventas v left join venta_pagos p on p.venta_id = v.id where v.codigo = $1`, [codigo])).rows[0];

type Venta = Awaited<ReturnType<typeof repo.registrarVenta>>;
const ventas: { nombre: string; v: Venta }[] = [];
// Registra una venta y controla: total esperado, suma de pagos = total (en la respuesta y en la base) y que baje el stock.
async function vender(nombre: string, items: { sku: string; cant: number }[], pagos: { medioId: string; monto: number | null }[],
  esperado: number, o: { especial?: { pct: number; motivo: string; autorizo: string }; clave?: string } = {}) {
  const antes = await Promise.all(items.map((i) => stockDe(i.sku, LOCAL)));
  const v = await repo.registrarVenta(LOCAL, items, pagos, o.clave, o.especial);
  ventas.push({ nombre, v });
  igual(`${nombre}: total`, v.total, esperado);
  igual(`${nombre}: suma de pagos = total`, v.pagos.reduce((s, p) => s + p.monto, 0), v.total);
  const b = await pagosEnBase(v.codigo);
  check(`${nombre}: en la base, pagos = total`, b.suma === b.total && b.total === v.total, `pagos ${b.suma}, total ${b.total}`);
  const despues = await Promise.all(items.map((i) => stockDe(i.sku, LOCAL)));
  igual(`${nombre}: baja el stock`, despues, antes.map((n, k) => n - items[k].cant));
  return v;
}

// ---- Porcentajes de los medios de pago: SIEMPRE de la base (la prueba sirve antes y despues del cambio de estructura de precios) ----
const mediosBase = await repo.listarMediosPago();
const pct = (id: string) => mediosBase.find((m) => m.id === id)?.ajustePct ?? NaN;
/** Lo que paga el cliente por `lista` pesos de lista en el medio `id`. */
const pc = (lista: number, id: string) => Math.round(lista * (1 + pct(id) / 100));
const cambio = await pool.query<{ aplicado_en: Date; factor: number; sufijo: string }>(
  "select aplicado_en, factor::float8 as factor, sufijo from cambios_lista where revertido_en is null order by id desc limit 1",
).then((r) => r.rows[0] ?? null).catch(() => null);
const sello = new Date().toISOString().replace(/\D/g, "").slice(2, 14);
const hoy = await inf.hoyArgentina();
const params = await inf.validarParams({ desde: hoy, hasta: hoy, sucursal: LOCAL });
const resumenAntes = (await inf.resumen(params)).total;
const stockAntes = await inf.stock(params);
const ingresosAntes = await inf.ingresos(params);
const notasAntes = (await inf.notasCredito(params)).resumen;
const cajaAntes = await repo.ventasDeHoy(LOCAL);

// Las promos reales vigentes cambiarian los totales: se apagan durante la prueba y se vuelven a prender al final.
const promosReales = (await pool.query<{ id: number }>("select id::int as id from promos where activa")).rows.map((r) => r.id);
if (promosReales.length) await pool.query("update promos set activa = false where id = any($1)", [promosReales]);

let A = "", B = "";
try {
  // ---- 1. Cargar prendas y enviarlas a un local ----
  await paso("Cargar prendas", async () => {
    const pa = await repo.cargar({ categoria: "Remera", nombre: `ZZ Prueba A ${sello}`, precio: 10000, cantidad: 20, reparto: { [LOCAL]: 15 } });
    const pb = await repo.cargar({ categoria: "Remera", nombre: `ZZ Prueba B ${sello}`, precio: 6000, cantidad: 10, reparto: { [LOCAL]: 10 } });
    A = pa.sku; B = pb.sku;
    igual("Carga A: queda en deposito", pa.stock.deposito, 5);
    igual("Carga A: en camino a White", pa.enCamino[LOCAL], 15);
    igual("Carga B: en camino a White", pb.enCamino[LOCAL], 10);
    igual("Carga: todavia sin stock en White", [await stockDe(A, LOCAL), await stockDe(B, LOCAL)], [0, 0]);
    check("Carga: aparece en el listado", (await repo.listar({ q: `ZZ Prueba ${sello}` })).length === 2);
  });
  if (!A || !B) throw new Error("No se pudieron cargar las prendas de prueba: no sigo.");

  // ---- 2. Recibir en el local ----
  await paso("Recibir en White", async () => {
    const r1 = await repo.recibirPrenda(LOCAL, A);
    igual("Recibir 1 prenda escaneada", [r1.desde, await stockDe(A, LOCAL)], ["deposito", 1]);
    const pend = (await repo.listarPendientes(LOCAL)).filter((t) => t.sku === A || t.sku === B);
    igual("Pendientes de recibir", pend.map((t) => t.cantidad - t.recibidas).sort(), [10, 14]);
    for (const t of pend) await repo.recibirTraslado(t.id, LOCAL);
    igual("Recibir todo: stock en White", [await stockDe(A, LOCAL), await stockDe(B, LOCAL)], [15, 10]);
    igual("Recibir todo: nada pendiente", (await repo.listarPendientes(LOCAL)).filter((t) => t.sku === A || t.sku === B).length, 0);
  });

  // ---- 3. Ventas con cada medio de pago (efectivo -20%, tarjeta +20%) ----
  igual("Medios de pago activos", mediosBase.map((m) => m.id).sort(), ["efectivo", "tarjeta", "transferencia"]);
  check("Medios: el efectivo nunca sale mas caro que la transferencia, ni esta mas que la tarjeta", pct("efectivo") <= pct("transferencia") && pct("transferencia") <= pct("tarjeta"),
    `efectivo ${pct("efectivo")}, transferencia ${pct("transferencia")}, tarjeta ${pct("tarjeta")}`);
  if (cambio) {
    igual("Estructura nueva: la lista es el precio de tarjeta (0%)", pct("tarjeta"), 0);
    check("Estructura nueva: efectivo y transferencia con descuento", pct("efectivo") < 0 && pct("transferencia") < 0 && pct("efectivo") <= pct("transferencia"));
  }
  await paso("Venta efectivo", async () => { await vender("Venta efectivo", [{ sku: A, cant: 1 }], [{ medioId: "efectivo", monto: null }], pc(10000, "efectivo")); });
  let vTransf: Venta | undefined, vMixta: Venta | undefined;
  await paso("Venta transferencia", async () => { vTransf = await vender("Venta transferencia", [{ sku: A, cant: 1 }], [{ medioId: "transferencia", monto: null }], pc(10000, "transferencia")); });
  await paso("Venta tarjeta", async () => { await vender("Venta tarjeta", [{ sku: A, cant: 1 }], [{ medioId: "tarjeta", monto: null }], pc(10000, "tarjeta")); });
  const mixtaTransf = Math.round(5000 / (1 + pct("transferencia") / 100)); // lista que cubren los 5.000 entregados por transferencia
  const mixtaEfvo = pc(20000 - mixtaTransf, "efectivo");
  await paso("Venta mixta", async () => {
    // Lista 20.000: 5.000 por transferencia (cubren 5.000 / (1 + %) de lista) + el resto en efectivo con su porcentaje.
    vMixta = await vender("Venta mixta", [{ sku: A, cant: 2 }], [{ medioId: "transferencia", monto: 5000 }, { medioId: "efectivo", monto: null }], 5000 + mixtaEfvo);
    igual("Venta mixta: dos pagos", vMixta.pagos.map((p) => `${p.medioId}:${p.monto}`), ["transferencia:5000", `efectivo:${mixtaEfvo}`]);
  });

  // ---- 4. Promos ----
  await paso("Promo 3x2", async () => {
    const p = await promosAdmin.crearPromo({ nombre: `ZZ 3x2 ${sello}`, tipo: "nxm", n: 3, m: 2, sucursales: [LOCAL], desde: hoy, hasta: hoy }, { usuarioId: null, origen: "staging-probar" });
    igual("Promo 3x2: vigente", p.estado, "vigente");
    // 10.000 + 10.000 + 6.000 = 26.000; la mas barata (6.000) va gratis: 20.000.
    const v = await vender("Venta 3x2", [{ sku: A, cant: 2 }, { sku: B, cant: 1 }], [{ medioId: "transferencia", monto: null }], pc(20000, "transferencia"));
    igual("Venta 3x2: descuento", v.promo?.monto, 6000);
    const enBase = (await pool.query("select promo_id::int as id from ventas where codigo = $1", [v.codigo])).rows[0].id;
    igual("Venta 3x2: guarda la promo", enBase, p.id);
    await promosAdmin.desactivarPromo(p.id);
    const fila = (await promosAdmin.listarPromos()).find((x) => x.id === p.id);
    igual("Promo 3x2: estadistica y baja", [fila?.estado, fila?.ventas, fila?.descontado], ["desactivada", 1, 6000]);
  });
  await paso("Promo precio", async () => {
    // "Todo a $5.000": por defecto SIN descuentos por medio de pago (precio unico): se paga lo mismo con efectivo, transferencia o tarjeta
    // (un recargo, si algun medio lo tuviera, se mantiene). 2 prendas de 10.000 en efectivo = 10.000.
    const p = await promosAdmin.crearPromo({ nombre: `ZZ Feria ${sello}`, tipo: "precio", precio: 5000, sucursales: [LOCAL], desde: hoy, hasta: hoy }, { usuarioId: null, origen: "staging-probar" });
    const unico = (id: string) => Math.round(5000 * (1 + Math.max(pct(id), 0) / 100));
    const v = await vender("Venta promo precio (efectivo)", [{ sku: A, cant: 2 }], [{ medioId: "efectivo", monto: null }], 2 * unico("efectivo"));
    igual("Promo precio: descuento", v.promo?.monto, 10000);
    const vt = await vender("Venta promo precio (transferencia)", [{ sku: A, cant: 1 }], [{ medioId: "transferencia", monto: null }], unico("transferencia"));
    const vk = await vender("Venta promo precio (tarjeta)", [{ sku: A, cant: 1 }], [{ medioId: "tarjeta", monto: null }], unico("tarjeta"));
    // Decision (d): sin descuento de efectivo los medios con descuento pasan a 0%: el efectivo NUNCA sale mas caro que la transferencia.
    check("Promo precio unico: efectivo <= transferencia <= tarjeta", v.total / 2 <= vt.total && vt.total <= vk.total, `${v.total / 2}, ${vt.total}, ${vk.total}`);
    await promosAdmin.desactivarPromo(p.id);
  });
  await paso("Promo precio con descuento de efectivo (precio ya ajustado)", async () => {
    // Una promo de precio que SI lleva los descuentos por medio de pago (la que el script de precios multiplica por la lista): P = 6.000 de lista.
    const p = await promosAdmin.crearPromo({ nombre: `ZZ Feria ajustada ${sello}`, tipo: "precio", precio: 6000, descuento_efectivo: true, sucursales: [LOCAL], desde: hoy, hasta: hoy }, { usuarioId: null, origen: "staging-probar" });
    const v = await vender("Venta promo precio con descuento (efectivo)", [{ sku: A, cant: 1 }], [{ medioId: "efectivo", monto: null }], pc(6000, "efectivo"));
    igual("Promo precio ajustada: descuento", v.promo?.monto, 4000);
    const vt = await vender("Venta promo precio con descuento (transferencia)", [{ sku: A, cant: 1 }], [{ medioId: "transferencia", monto: null }], pc(6000, "transferencia"));
    check("Promo precio ajustada: el efectivo sale mas barato que la transferencia", v.total <= vt.total, `${v.total} vs ${vt.total}`);
    await promosAdmin.desactivarPromo(p.id);
  });
  await paso("Medios para promo sin descuento", async () => {
    const sinDesc = mediosParaPromo(mediosBase, { descuentoEfectivo: false });
    const conDesc = mediosParaPromo(mediosBase, { descuentoEfectivo: true });
    igual("Sin descuento: ningun medio queda con descuento", sinDesc.every((m) => m.ajustePct >= 0), true);
    igual("Con descuento: los medios quedan como en la base", conDesc.map((m) => m.ajustePct), mediosBase.map((m) => m.ajustePct));
    const cuanto = (id: string) => sinDesc.find((m) => m.id === id)!.ajustePct;
    check("Sin descuento: efectivo no paga mas que la transferencia", cuanto("efectivo") <= cuanto("transferencia"), `${cuanto("efectivo")} vs ${cuanto("transferencia")}`);
  });
  await paso("Descuento especial", async () => {
    // 16.000 con 10% especial = 14.400 a precio de lista, con el porcentaje de la transferencia; queda en auditoria y en Oficina > Promos.
    const v = await vender("Venta descuento especial", [{ sku: A, cant: 1 }, { sku: B, cant: 1 }], [{ medioId: "transferencia", monto: null }], pc(14400, "transferencia"),
      { especial: { pct: 10, motivo: "ZZ prueba automatica", autorizo: "ZZ Staging" } });
    const a = await pool.query("select 1 from auditoria where accion = 'descuento_especial' and detalle->>'venta' = $1", [v.codigo]);
    igual("Descuento especial: auditado", a.rowCount, 1);
    check("Descuento especial: lo ve la oficina", (await promosAdmin.descuentosEspeciales(20)).some((x) => x.codigo === v.codigo));
  });

  await paso("Curva Plus (solo Deposito)", async () => {
    const cp = { pct: 0, motivo: "", autorizo: "ZZ Staging", curvaPlus: true };
    await debeFallar("Curva Plus: fuera de Deposito no", () => repo.registrarVenta(LOCAL, [{ sku: A, cant: 1 }], [{ medioId: "transferencia", monto: null }], undefined, cp), /solo se aplica/);
    const DEPO = "deposito";
    const C = (await repo.cargar({ categoria: "Remera", nombre: `ZZ Curva ${sello}`, precio: 20000, cantidad: 4, reparto: {} })).sku;
    const v = await repo.registrarVenta(DEPO, [{ sku: C, cant: 2 }], [{ medioId: "transferencia", monto: null }], undefined, { ...cp, pct: 50 });
    igual("Curva Plus: 25% fijo sobre la lista (el % que mande la pantalla no cuenta)", v.total, pc(30000, "transferencia"));
    igual("Curva Plus: nombre en el ticket", v.promo?.nombre, "Curva Plus (25%)");
    const ve = await repo.registrarVenta(DEPO, [{ sku: C, cant: 1 }], [{ medioId: "efectivo", monto: null }], undefined, cp);
    igual("Curva Plus: con efectivo se suma el descuento del medio", ve.total, pc(15000, "efectivo"));
    const a = await pool.query("select 1 from auditoria where accion = 'curva_plus' and detalle->>'venta' = $1", [v.codigo]);
    igual("Curva Plus: auditado", a.rowCount, 1);
    check("Curva Plus: lo ve la oficina", (await promosAdmin.descuentosEspeciales(20)).some((x) => x.codigo === v.codigo && x.motivo === "Curva Plus"));
  });

  await paso("Ajustar lo que esta en camino y eliminar con envios pendientes", async () => {
    const ZEL = "zelarrayan";
    const M = (await repo.cargar({ categoria: "Malla", nombre: `ZZ Malla ${sello}`, precio: 9000, cantidad: 14, reparto: { [LOCAL]: 10, [ZEL]: 4 } })).sku;
    await debeFallar("En camino: no se puede subir", () => repo.ajustarEnCamino(M, LOCAL, 12, "ZZ prueba"), /solo se puede bajar/);
    const p1 = await repo.ajustarEnCamino(M, LOCAL, 6, "ZZ se mandaron de mas");
    igual("En camino: baja de 10 a 6 sin tocar el stock", [p1.enCamino[LOCAL], p1.stock["deposito"] ?? 0], [6, 0]);
    const pend = (await repo.listarPendientes(LOCAL)).filter((t) => t.sku === M);
    igual("En camino: el local ve 6 para recibir", pend.reduce((s, t) => s + (t.cantidad - t.recibidas), 0), 6);
    await repo.eliminar(M);
    igual("Eliminar: ya no queda nada en camino", (await repo.listarPendientes(ZEL)).filter((t) => t.sku === M).length, 0);
  });

  await paso("Retiro de la empresa (regalo sin cobrar)", async () => {
    const R = (await repo.cargar({ categoria: "Remera", nombre: `ZZ Miche ${sello}`, precio: 10950, cantidad: 6, reparto: {} })).sku;
    await debeFallar("Retiro: sin motivo no", () => repo.retiroEmpresa("deposito", [{ sku: R, cant: 1 }], "x"), /para quién/);
    await debeFallar("Retiro: no mas que el stock", () => repo.retiroEmpresa("deposito", [{ sku: R, cant: 9 }], "ZZ regalo prueba"), /solo hay/);
    const ventasAntes = (await pool.query("select count(*)::int as n from ventas")).rows[0].n;
    const r = await repo.retiroEmpresa("deposito", [{ sku: R, cant: 5 }], "ZZ regalo a cliente prueba");
    igual("Retiro: unidades y valor a lista", [r.unidades, r.valorLista], [5, 54750]);
    igual("Retiro: baja el stock", await stockDe(R, "deposito"), 1);
    igual("Retiro: no crea ventas", (await pool.query("select count(*)::int as n from ventas")).rows[0].n, ventasAntes);
    const lista = await repo.retirosEmpresa(20);
    check("Retiro: lo ve la oficina con el motivo", lista.some((x) => x.sku === R && x.cantidad === 5 && x.motivo === "ZZ regalo a cliente prueba" && x.valor === 54750));
  });

  await paso("Regalo de la empresa con una compra", async () => {
    const G = (await repo.cargar({ categoria: "Remera", nombre: `ZZ Regalo ${sello}`, precio: 12000, cantidad: 5, reparto: {} })).sku;
    const tr = [{ medioId: "transferencia", monto: null as number | null }];
    const v = await repo.registrarVenta("deposito", [{ sku: G, cant: 3 }], tr, undefined, undefined, undefined, [{ sku: G, cant: 1 }]);
    igual("Regalo: se cobran solo las 3", v.total, pc(36000, "transferencia"));
    igual("Regalo: sale en el ticket", v.regalos, [{ sku: G, nombre: v.items[0].nombre, cant: 1 }]);
    igual("Regalo: baja 4 del stock", await stockDe(G, "deposito"), 1);
    check("Regalo: lo ve la oficina", (await repo.retirosEmpresa(20)).some((x) => x.sku === G && x.cantidad === 1 && x.motivo.includes(v.codigo)));
    igual("Regalo: el ticket reimpreso lo trae", (await repo.ticketPorCodigo(v.codigo, null)).regalos?.[0]?.cant, 1);
    await debeFallar("Regalo: no alcanza el stock", () => repo.registrarVenta("deposito", [{ sku: G, cant: 1 }], tr, undefined, undefined, undefined, [{ sku: G, cant: 1 }]), /no alcanza/);
    await repo.anularVenta(v.codigo, "ZZ prueba regalo", { soloSucursal: null, admin: true });
    igual("Regalo: al anular vuelve todo al stock", await stockDe(G, "deposito"), 5);
  });

  await paso("Cuenta Deposito con stock de Zelarrayan", async () => {
    const ZEL = "zelarrayan";
    const Z = (await repo.cargar({ categoria: "Remera", nombre: `ZZ DepZel ${sello}`, precio: 15000, cantidad: 4, reparto: { [ZEL]: 3 } })).sku;
    for (const t of await repo.listarPendientes(ZEL)) if (t.sku === Z) await repo.recibirTraslado(t.id, ZEL);
    const tr = [{ medioId: "transferencia", monto: null as number | null }];
    const v = await repo.registrarVenta("deposito", [{ sku: Z, cant: 2 }], tr, undefined, undefined, undefined, [], [ZEL]);
    igual("DepZel: descuenta de Zelarrayan, no de Deposito", [await stockDe(Z, ZEL), await stockDe(Z, "deposito")], [1, 1]);
    const fila = (await pool.query("select v.sucursal_id, vi.stock_de from ventas v join venta_items vi on vi.venta_id = v.id where v.codigo = $1", [v.codigo])).rows[0];
    igual("DepZel: la venta (la plata) es de Deposito y el stock de Zelarrayan", [fila.sucursal_id, fila.stock_de], ["deposito", ZEL]);
    await debeFallar("DepZel: no puede vender stock de Deposito", () => repo.registrarVenta("deposito", [{ sku: Z, cant: 1, origen: "deposito" }], tr, undefined, undefined, undefined, [], [ZEL]), /no puede vender/);
    await repo.anularVenta(v.codigo, "ZZ prueba depzel", { soloSucursal: null, admin: true });
    igual("DepZel: al anular vuelve a Zelarrayan", await stockDe(Z, ZEL), 3);
  });

  // ---- 5. Devoluciones y notas de credito ----
  let nota1 = "", nota2 = "", ajuste2 = 0, monto2 = 0;
  await paso("Devolucion", async () => {
    const dv = await repo.ventaParaDevolucion(vTransf!.codigo, LOCAL);
    const antes = await stockDe(A, LOCAL);
    const n = await repo.emitirNota(LOCAL, vTransf!.codigo, [{ itemId: dv.items[0].id, cant: 1, falladas: 0 }], LOCAL);
    nota1 = n.codigo;
    igual("Devolucion: monto de la nota", [n.montoInicial, n.saldo], [vTransf!.total, vTransf!.total]);
    if (cambio) igual("Devolucion de una venta posterior al corte: sin conversion", n.ajustePct, pct("transferencia"));
    igual("Devolucion: vuelve al stock", await stockDe(A, LOCAL), antes + 1);
    await debeFallar("Devolucion: no se devuelve dos veces", () => repo.emitirNota(LOCAL, vTransf!.codigo, [{ itemId: dv.items[0].id, cant: 1, falladas: 0 }], LOCAL), /ya se devolvieron/);
  });
  await paso("Devolucion con fallada", async () => {
    const dv = await repo.ventaParaDevolucion(vMixta!.codigo, LOCAL);
    const antes = await stockDe(A, LOCAL);
    // Venta mixta: 20.000 de lista pagados `vMixta.total`. La nota vale lo pagado y lleva el ajuste promedio de los dos medios.
    const n = await repo.emitirNota(LOCAL, vMixta!.codigo, [{ itemId: dv.items[0].id, cant: 2, falladas: 1 }], LOCAL);
    nota2 = n.codigo; ajuste2 = n.ajustePct; monto2 = n.montoInicial;
    igual("Devolucion mixta: nota y ajuste", [n.montoInicial, n.ajustePct], [vMixta!.total, Math.round((vMixta!.total / 20000 - 1) * 1_000_000) / 10_000]);
    igual("Devolucion mixta: la fallada no vuelve al stock", await stockDe(A, LOCAL), antes + 1);
  });
  await paso("Pagar con nota", async () => {
    const v = await vender("Venta pagada con nota", [{ sku: A, cant: 1 }], [{ medioId: `nota:${nota1}`, monto: vTransf!.total }, { medioId: "transferencia", monto: null }], vTransf!.total);
    igual("Pago con nota: un solo pago", v.pagos.length, 1);
    igual("Pago con nota: saldo", (await repo.notaPorCodigo(nota1)).saldo, 0);
    await debeFallar("Nota usada: no se puede usar otra vez", () => repo.registrarVenta(LOCAL, [{ sku: A, cant: 1 }], [{ medioId: `nota:${nota1}`, monto: vTransf!.total }, { medioId: "transferencia", monto: null }]), /ya fue usada/);
  });
  await paso("Pagar con parte de una nota", async () => {
    // 16.000 de lista con la nota de la venta mixta: la nota cubre 16.000 x (1 + ajuste); lo que sobra queda de saldo.
    const k = 1 + ajuste2 / 100;
    const usa = montoNotaAplicable(16000, monto2, ajuste2);
    igual("Parte de nota: monto aplicable", usa, Math.min(monto2, Math.round(16000 * k)));
    const resto = 16000 - Math.round(usa / k);
    await vender("Venta con parte de nota", [{ sku: A, cant: 1 }, { sku: B, cant: 1 }], [{ medioId: `nota:${nota2}`, monto: usa }, { medioId: "efectivo", monto: null }], usa + (resto > 0 ? pc(resto, "efectivo") : 0));
    igual("Parte de nota: saldo que queda", (await repo.notaPorCodigo(nota2)).saldo, monto2 - usa);
  });

  // ---- 6. Controles de seguridad de la caja ----
  await paso("Cobro repetido", async () => {
    const clave = `zz-staging-${sello}`;
    const v1 = await vender("Cobro con clave", [{ sku: A, cant: 1 }], [{ medioId: "transferencia", monto: null }], pc(10000, "transferencia"), { clave });
    const antes = await stockDe(A, LOCAL);
    const v2 = await repo.registrarVenta(LOCAL, [{ sku: A, cant: 1 }], [{ medioId: "transferencia", monto: null }], clave);
    igual("Cobro repetido: no duplica la venta", [v2.nueva, v2.codigo, await stockDe(A, LOCAL)], [false, v1.codigo, antes]);
  });
  await debeFallar("Sin stock suficiente: no vende", () => repo.registrarVenta(LOCAL, [{ sku: B, cant: 999 }], [{ medioId: "efectivo", monto: null }]), /solo hay/);
  await debeFallar("Pago que se pasa del total: no vende", () => repo.registrarVenta(LOCAL, [{ sku: B, cant: 1 }], [{ medioId: "transferencia", monto: 50000 }, { medioId: "efectivo", monto: null }]), /supera/);

  // ---- 7. Reimprimir tickets ----
  await paso("Reimprimir tickets", async () => {
    for (const { nombre, v } of ventas) {
      const t = await repo.ticketPorCodigo(v.codigo, LOCAL);
      check(`Reimprimir: ${nombre}`, t.total === v.total && t.sucursal === LOCAL && t.pagos.reduce((s, p) => s + p.monto, 0) === v.total
        && t.items.reduce((s, i) => s + i.cant, 0) === v.items.reduce((s, i) => s + i.cant, 0), `ticket ${t.total}, venta ${v.total}`);
    }
    await debeFallar("Reimprimir: otro local no ve el ticket", () => repo.ticketPorCodigo(ventas[0].v.codigo, "zelarrayan"), /se hizo en/);
  });

  // ---- 8. Informes: lo vendido hoy tiene que aparecer exacto ----
  await paso("Informes", async () => {
    const nuevas = ventas.filter((x) => x.v.nueva);
    const sumTotal = nuevas.reduce((s, x) => s + x.v.total, 0);
    const sumLista = nuevas.reduce((s, x) => s + x.v.subtotal, 0);
    const conNotas = nuevas.reduce((s, x) => s + x.v.pagos.filter((p) => p.medioId.startsWith("nota:")).reduce((t, p) => t + p.monto, 0), 0);
    const r = (await inf.resumen(params)).total;
    igual("Informe resumen: ventas", r.ventas - resumenAntes.ventas, nuevas.length);
    igual("Informe resumen: total pagado", r.totalPagado - resumenAntes.totalPagado, sumTotal);
    igual("Informe resumen: a precio de lista", r.lista - resumenAntes.lista, sumLista);
    igual("Informe resumen: pagado con notas", r.pagadoConNotas - resumenAntes.pagadoConNotas, conNotas);
    igual("Informe resumen: cobrado en caja", r.cobradoEnCaja - resumenAntes.cobradoEnCaja, sumTotal - conNotas);
    igual("Informe resumen: medios suman el total", r.porMedio.reduce((s, m) => s + m.monto, 0), r.totalPagado);
    const st = await inf.stock(params);
    igual("Informe stock: unidades en White", st.totalUnidades - stockAntes.totalUnidades, (await stockDe(A, LOCAL)) + (await stockDe(B, LOCAL)));
    const ing = await inf.ingresos(params);
    igual("Informe ingresos: cargado", ing.totalCargado - ingresosAntes.totalCargado, 63); // 30 + 4 (Curva Plus) + 14 (en camino) + 6 (retiro) + 5 (regalo) + 4 (depzel)
    const env = (x: typeof ing) => x.enviosPorDestino.find((e) => e.destino === LOCAL) ?? { enviadas: 0, recibidas: 0 };
    igual("Informe ingresos: enviado y recibido", [env(ing).enviadas - env(ingresosAntes).enviadas, env(ing).recibidas - env(ingresosAntes).recibidas], [25, 25]);
    const nc = (await inf.notasCredito(params)).resumen;
    igual("Informe notas: emitidas y usadas", [nc.emitidas - notasAntes.emitidas, nc.montoEmitido - notasAntes.montoEmitido, nc.usadoComoPagoEnElPeriodo - notasAntes.usadoComoPagoEnElPeriodo], [2, vTransf!.total + monto2, conNotas]);
    const caja = await repo.ventasDeHoy(LOCAL);
    igual("Caja del dia: cantidad de ventas", caja.ventas - cajaAntes.ventas, nuevas.length);
    check("Panel completo (todos los informes)", !!(await inf.panelCompleto(await inf.validarParams({}))).resumen);
    check("Listado de ventas del dia", (await repo.ventasListado(LOCAL, hoy, hoy)).filter((x) => nuevas.some((n) => n.v.codigo === x.codigo)).length === nuevas.length);
  });


  // ---- 8b. Nueva estructura de precios: devolucion de una venta anterior al corte, nota convertida usada en una compra ----
  await paso("Devolucion de una venta anterior al corte", async () => {
    const corte = await repo.corteDeLista();
    if (!corte) { check("Corte de lista: sin cambio aplicado no hay conversion (estructura anterior)", true); return; }
    // "Se envejece" una venta de prueba a 1 hora antes del corte (solo en la copia: el trigger de ventas se destraba con app.mantenimiento).
    const objetivo = new Date(corte.fecha.getTime() - 3_600_000);
    if (Date.now() - objetivo.getTime() > 14 * 86_400_000) { check("Corte de lista: el cambio tiene mas de 14 dias, no se puede probar la devolucion anterior al corte", true); return; }
    const v = await repo.registrarVenta(LOCAL, [{ sku: B, cant: 2 }], [{ medioId: "efectivo", monto: null }]);
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("set local app.mantenimiento = 'on'");
      await c.query("update ventas set creado_en = $2 where codigo = $1", [v.codigo, objetivo]);
      await c.query("commit");
    } finally { c.release(); }
    const dv = await repo.ventaParaDevolucion(v.codigo, LOCAL);
    igual("Devolucion anterior al corte: el valor mostrado es lo que se pago", dv.items[0].valor, Math.round(v.total / 2));
    const n = await repo.emitirNota(LOCAL, v.codigo, [{ itemId: dv.items[0].id, cant: 2, falladas: 0 }], LOCAL);
    const k = 1 + pct("efectivo") / 100;
    const esperado = Math.round((k / corte.factor - 1) * 1_000_000) / 10_000;
    igual("Devolucion anterior al corte: la nota vale lo que se pago", n.montoInicial, v.total);
    igual("Devolucion anterior al corte: porcentaje convertido (÷ factor)", n.ajustePct, esperado);
    // La nota cubre la misma prenda: con la lista nueva (x factor) el valor de lista que cubre es factor veces el de antes.
    const valorAntes = n.montoInicial / k, valorAhora = n.montoInicial / (1 + n.ajustePct / 100);
    check("Nota convertida: cubre factor veces el valor de lista", Math.abs(valorAhora - valorAntes * corte.factor) <= 1, `${valorAhora} vs ${valorAntes * corte.factor}`);
    // Usada en una compra de B (6.000 de lista): paga 6.000 x (1 + %nota) y el resto queda de saldo.
    const paga = Math.round(6000 * (1 + n.ajustePct / 100));
    const vn = await vender("Venta pagada con nota convertida", [{ sku: B, cant: 1 }], [{ medioId: `nota:${n.codigo}`, monto: paga }, { medioId: "transferencia", monto: null }], paga);
    igual("Nota convertida: saldo que queda", (await repo.notaPorCodigo(n.codigo)).saldo, n.montoInicial - paga);
    // Ticket: la nota nunca muestra porcentaje (puede ser -41,6667) y los descuentos salen redondeados.
    const t = await repo.ticketPorCodigo(vn.codigo, LOCAL);
    const pn = t.pagos.find((x) => x.medioId.toLowerCase().startsWith("nota"));
    check("Ticket con nota: el pago con nota existe", !!pn);
    if (pn) {
      igual("Ticket con nota: se guarda el porcentaje con decimales", Math.round(pn.pct * 10_000) / 10_000, n.ajustePct);
      igual("Ticket con nota: sin porcentaje en la linea", lineasTicket(t).textoPct(pn.pct, pn.medioId), "");
    }
  });
  await paso("Formato de porcentajes", async () => {
    const tp = lineasTicket({ items: [], subtotal: 0, ajuste: 0, total: 0, pagos: [], promo: undefined } as never).textoPct;
    igual("Porcentaje -30", tp(-30), " (-30%)");
    igual("Porcentaje -33.3333 sin decimales feos", tp(-33.3333), " (-33,3%)");
    igual("Porcentaje de una nota", tp(-16.6667, "nota_credito"), "");
    igual("Un recargo no se muestra", tp(20), "");
  });
  await paso("Notas vigentes convertidas por el script de precios", async () => {
    if (!cambio || !/^\d{6}$/.test(cambio.sufijo)) { check("Notas convertidas: no hay cambio aplicado (se omite)", true); return; }
    const r = await pool.query<{ codigo: string; antes: number; ahora: number }>(
      `select n.codigo, r.ajuste_pct::float8 as antes, n.ajuste_pct::float8 as ahora from respaldo_notas_${cambio.sufijo} r join notas_credito n on n.id = r.id`);
    check("Notas convertidas: hay respaldo", r.rowCount !== null);
    for (const x of r.rows) {
      const esperado = Math.round(((1 + x.antes / 100) / cambio.factor - 1) * 1_000_000) / 10_000;
      check(`Nota ${x.codigo}: ${x.antes}% -> ${esperado}%`, Math.abs(x.ahora - esperado) < 0.00006, `en la base ${x.ahora}`);
    }
    const p = await pool.query<{ id: number; antes: number | null; ahora: number | null }>(
      `select r.id::int as id, r.precio as antes, p.precio as ahora from respaldo_promos_${cambio.sufijo} r join promos p on p.id = r.id`);
    for (const x of p.rows) check(`Promo ${x.id}: precio ${x.antes} -> ${x.ahora}`, x.ahora !== null && x.antes !== null && Math.abs(x.ahora - x.antes * cambio.factor) < 1000, "");
    const a = await pool.query("select 1 from auditoria where accion = 'cambio_estructura_precios'");
    check("Auditoria: queda la fila del cambio", (a.rowCount ?? 0) >= 1);
    const m = await pool.query<{ n: number }>(`select count(*)::int as n from productos p join respaldo_precios_${cambio.sufijo} r using (sku) where p.precio_lista < r.precio_lista`);
    igual("Ninguna lista bajo con el cambio", m.rows[0].n, 0);
  });

  // ---- 8c. Etiquetas: el TSPL entra en 50x30 mm (400x240 puntos), sin cortarse ni encimarse ----
  await paso("Etiquetas", async () => {
    const { default: JsBarcode } = await import("jsbarcode");
    const { PDFDocument } = await import("pdf-lib");
    const ANCHO: Record<string, number> = { "2": 12, "3": 16, "4": 24 }, ALTO: Record<string, number> = { "2": 20, "3": 24, "4": 32 };
    const W = empresa.etiquetaMm.ancho * 8, H = empresa.etiquetaMm.alto * 8;
    const casos = [
      { nombre: `ZZ corta`, precio: 10000 },
      { nombre: `ZZ Remera oversize lisa negra con estampa grande`, precio: 36900 },
      { nombre: `ZZ Campera de abrigo`, precio: 126900 },
    ];
    for (const c of casos) {
      const precios = preciosDe(c.precio, mediosBase);
      const t = etiquetaTspl({ sku: A, nombre: c.nombre, precios }, 2).split("\r\n");
      const rotulo = `Etiqueta ${c.precio}`;
      check(`${rotulo}: BITMAP en blanco inicial intacto`, t.some((l) => l.startsWith(`BITMAP 0,0,${W / 8},${H},0,`)));
      const txt = t.filter((l) => l.startsWith("TEXT ")).map((l) => l.replace(/^TEXT \d+,\d+,"\d",0,1,1,"/, "").replace(/"$/, "")).join(" | ");
      check(`${rotulo}: dice Transferencia, Efectivo y las cuotas`, txt.includes("Transferencia") && txt.includes("Efectivo") && txt.includes("cuotas"), txt);
      const rects: { n: string; x: number; y: number; w: number; h: number }[] = [];
      for (const l of t) {
        const m = /^TEXT (\d+),(\d+),"(\d)",0,1,1,"(.*)"$/.exec(l);
        if (m) rects.push({ n: m[4], x: +m[1], y: +m[2], w: m[4].length * ANCHO[m[3]], h: ALTO[m[3]] });
        const b = /^BARCODE (\d+),(\d+),"128",(\d+),/.exec(l);
        if (b) { const o: { encodings?: { data: string }[] } = {}; JsBarcode(o, A, { format: "CODE128", displayValue: false }); rects.push({ n: "barras", x: +b[1], y: +b[2], w: (o.encodings ?? []).reduce((q, e) => q + e.data.length, 0) * 2, h: +b[3] }); }
      }
      const fuera = rects.filter((r) => r.x < 0 || r.y < 0 || r.x + r.w > W || r.y + r.h > H);
      check(`${rotulo}: nada se sale de ${W}x${H} puntos`, fuera.length === 0, fuera.map((r) => `${r.n} (${r.x + r.w},${r.y + r.h})`).join("; "));
      const encima: string[] = [];
      rects.forEach((a, i) => rects.slice(i + 1).forEach((b) => { if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) encima.push(`${a.n} / ${b.n}`); }));
      check(`${rotulo}: nada se encima`, encima.length === 0, encima.join("; "));
      const margenAbajo = H - Math.max(...rects.map((r) => r.y + r.h));
      check(`${rotulo}: queda margen abajo (${margenAbajo} puntos)`, margenAbajo >= 4, `${margenAbajo}`);
    }
    const pdf = await etiquetasPdf(casos.map((c) => ({ sku: A, nombre: c.nombre, precios: preciosDe(c.precio, mediosBase) })));
    igual("Etiquetas en PDF: una pagina por etiqueta", (await PDFDocument.load(pdf)).getPageCount(), casos.length);
    check("Texto de la vista previa", textoPrecioEtiqueta(preciosDe(36900, mediosBase)[0]).startsWith("Transferencia: $"), textoPrecioEtiqueta(preciosDe(36900, mediosBase)[0]));
  });

  // ---- 8b. Deposito vendiendo con stock de San Lorenzo + anular ventas (migracion 018) ----
  await paso("Origen del stock y anulaciones", async () => {
    const DEP = "deposito", SL = "sanlorenzo";
    const C = (await repo.cargar({ categoria: "Remera", nombre: `ZZ Origen ${sello}`, precio: 10000, cantidad: 10, reparto: { [SL]: 6 } })).sku;
    for (const t of await repo.listarPendientes(SL)) if (t.sku === C) await repo.recibirTraslado(t.id, SL);
    igual("Origen: stock inicial deposito / San Lorenzo", [await stockDe(C, DEP), await stockDe(C, SL)], [4, 6]);
    const pagoTr = [{ medioId: "transferencia", monto: null as number | null }];
    const origenDe = async (codigo: string) => (await pool.query<{ d: string | null; m: string }>(
      `select vi.stock_de as d, (select m.desde from movimientos m where m.venta_id = v.id limit 1) as m from ventas v join venta_items vi on vi.venta_id = v.id where v.codigo = $1 limit 1`, [codigo])).rows[0];

    // El deposito vende con ropa de San Lorenzo
    const vSL = await repo.registrarVenta(DEP, [{ sku: C, cant: 2, origen: SL }], pagoTr);
    igual("Origen: baja el stock de San Lorenzo, no el del deposito", [await stockDe(C, DEP), await stockDe(C, SL)], [4, 4]);
    igual("Origen: queda anotado de donde salio", await origenDe(vSL.codigo), { d: SL, m: SL });
    const vDep = await repo.registrarVenta(DEP, [{ sku: C, cant: 1 }], pagoTr);
    igual("Origen: sin indicar, sale del deposito", [await stockDe(C, DEP), await stockDe(C, SL), (await origenDe(vDep.codigo)).d], [3, 4, null]);
    const vMix = await repo.registrarVenta(DEP, [{ sku: C, cant: 1, origen: DEP }, { sku: C, cant: 1, origen: SL }], pagoTr);
    // Foto de la caja y los informes con la venta ya hecha (para ver que al anularla deje de contar).
    const antesMix = { caja: (await repo.ventasDeHoy(DEP)), inf: (await inf.resumen(await inf.validarParams({ desde: hoy, hasta: hoy, sucursal: DEP }))).total };
    igual("Origen: un mismo producto de los dos stocks", [await stockDe(C, DEP), await stockDe(C, SL)], [2, 3]);
    await debeFallar("Origen: otro local no puede usar stock ajeno", () => repo.registrarVenta(LOCAL, [{ sku: C, cant: 1, origen: SL }], pagoTr), /otra sucursal/);
    await debeFallar("Origen: no vende mas de lo que hay en ese stock", () => repo.registrarVenta(DEP, [{ sku: C, cant: 5, origen: DEP }], pagoTr), /solo hay/);
    await debeFallar("Origen: renglon repetido", () => repo.registrarVenta(DEP, [{ sku: C, cant: 1, origen: DEP }, { sku: C, cant: 1, origen: DEP }], pagoTr), /repetida/);

    // Devolucion: vuelve a San Lorenzo, que es de donde salio
    const dvSL = await repo.ventaParaDevolucion(vSL.codigo, DEP);
    await repo.emitirNota(DEP, vSL.codigo, [{ itemId: dvSL.items[0].id, cant: 1, falladas: 0 }], DEP);
    igual("Devolucion de venta con stock de San Lorenzo: vuelve a San Lorenzo", [await stockDe(C, DEP), await stockDe(C, SL)], [2, 4]);

    // Anular
    await debeFallar("Anular: motivo corto", () => repo.anularVenta(vMix.codigo, "no", { soloSucursal: null, admin: true }), /motivo/);
    await debeFallar("Anular: otro local no puede", () => repo.anularVenta(vDep.codigo, "ticket equivocado", { soloSucursal: LOCAL, admin: false }), /se hizo en/);
    await debeFallar("Anular: ticket inexistente", () => repo.anularVenta("V00000000", "ticket equivocado", { soloSucursal: null, admin: true }), /No existe/);
    await debeFallar("Anular: con devolucion no se puede", () => repo.anularVenta(vSL.codigo, "ticket equivocado", { soloSucursal: DEP, admin: false }), /devolución/);
    const a = await repo.anularVenta(vMix.codigo, "se cobro la prenda equivocada", { soloSucursal: DEP, admin: false });
    igual("Anular: unidades y total", [a.unidades, a.total], [2, vMix.total]);
    igual("Anular: el stock vuelve de donde salio", [await stockDe(C, DEP), await stockDe(C, SL)], [3, 5]);
    const despCaja = await repo.ventasDeHoy(DEP);
    igual("Anular: deja de contar en la caja del dia", [antesMix.caja.ventas - despCaja.ventas, Math.round(antesMix.caja.filas.reduce((t, f) => t + f.total, 0) - despCaja.filas.reduce((t, f) => t + f.total, 0))], [1, vMix.total]);
    const infDesp = (await inf.resumen(await inf.validarParams({ desde: hoy, hasta: hoy, sucursal: DEP }))).total;
    igual("Anular: deja de contar en los informes", [infDesp.ventas - antesMix.inf.ventas, infDesp.totalPagado - antesMix.inf.totalPagado], [-1, -vMix.total]);
    const res = await (await import("../lib/cierre")).resumenDia(DEP, hoy);
    igual("Anular: el resumen del cierre no la cuenta", res.ventas, despCaja.ventas);
    const lst = (await repo.ventasListado(DEP, hoy, hoy)).find((x) => x.codigo === vMix.codigo);
    igual("Anular: el listado la muestra como anulada", lst?.anulada, true);
    await debeFallar("Anular: dos veces no", () => repo.anularVenta(vMix.codigo, "ticket equivocado", { soloSucursal: null, admin: true }), /ya estaba anulada/);
    await debeFallar("Anular: una anulada no se devuelve", () => repo.ventaParaDevolucion(vMix.codigo, DEP), /anulada/);
    await debeFallar("Anular: ni se emite nota de una anulada", () => repo.emitirNota(DEP, vMix.codigo, [{ itemId: 1, cant: 1, falladas: 0 }], DEP), /anulada/);
    const reg = await pool.query<{ n: number }>("select count(*)::int as n from movimientos m join ventas v on v.id = m.venta_id where v.codigo = $1 and m.tipo = 'anulacion'", [vMix.codigo]);
    igual("Anular: queda el movimiento de anulacion por cada renglon", reg.rows[0].n, 2);
    // Una anulacion no se puede borrar ni cambiar
    let borro = false;
    try { await pool.query("delete from ventas_anuladas where venta_id = (select id from ventas where codigo = $1)", [vMix.codigo]); borro = true; } catch { /* esperado: la base lo impide */ }
    check("Anular: el registro de la anulacion no se puede borrar", !borro, "se pudo borrar");

    // Venta pagada con nota de credito: no se anula desde el local
    const vBase = await repo.registrarVenta(DEP, [{ sku: C, cant: 1 }], pagoTr);
    const nBase = await repo.emitirNota(DEP, vBase.codigo, [{ itemId: (await repo.ventaParaDevolucion(vBase.codigo, DEP)).items[0].id, cant: 1, falladas: 0 }], DEP);
    const vNota = await repo.registrarVenta(DEP, [{ sku: C, cant: 1 }], [{ medioId: `nota:${nBase.codigo}`, monto: Math.min(nBase.saldo, vBase.total) }, { medioId: "transferencia", monto: null }]);
    await debeFallar("Anular: pagada con nota de credito no se anula", () => repo.anularVenta(vNota.codigo, "ticket equivocado", { soloSucursal: DEP, admin: false }), /nota de crédito/);

    // Caja cerrada: no se anula. (Se cierra a mano y se deshace al final para poder repetir la prueba el mismo dia.)
    const vCierre = await repo.registrarVenta(DEP, [{ sku: C, cant: 1 }], pagoTr);
    await pool.query(`insert into cierres_caja (sucursal_id, dia, cerrado_por, ventas, unidades, esperado, contado, efectivo_esperado, efectivo_contado, diferencia)
      values ($1, $2::date, 'ZZ Staging', 0, 0, '{}', '{}', 0, 0, 0)`, [DEP, hoy]);
    try {
      await debeFallar("Anular: con la caja del dia cerrada no se puede", () => repo.anularVenta(vCierre.codigo, "ticket equivocado", { soloSucursal: DEP, admin: true }), /cerrada/);
    } finally {
      const c = await pool.connect();
      try { await c.query("begin"); await c.query("set local app.mantenimiento = 'on'"); await c.query("delete from cierres_caja where cerrado_por = 'ZZ Staging'"); await c.query("commit"); } finally { c.release(); }
    }
    const b = await repo.anularVenta(vCierre.codigo, "ticket equivocado", { soloSucursal: DEP, admin: true });
    igual("Anular: con la caja abierta, el admin si puede", b.codigo, vCierre.codigo);
  });

  // ---- 8c. Vender lo que el sistema no tiene (la prenda esta en el local) y prendas sin cargar ----
  await paso("Vender sin stock en el sistema", async () => {
    const ZEL = "zelarrayan";
    const pagoTr = [{ medioId: "transferencia", monto: null as number | null }];
    const D = (await repo.cargar({ categoria: "Remera", nombre: `ZZ Retrato ${sello}`, precio: 17500, cantidad: 3, reparto: { [ZEL]: 3 } })).sku;
    for (const t of await repo.listarPendientes(ZEL)) if (t.sku === D) await repo.recibirTraslado(t.id, ZEL);
    await debeFallar("Sin stock: sin respuesta, no vende", () => repo.registrarVenta(LOCAL, [{ sku: D, cant: 1 }], pagoTr), /no tiene stock/);
    // El sistema la tiene en Zelarrayan pero esta aca: se pasa y se vende
    const v1 = await repo.registrarVenta(LOCAL, [{ sku: D, cant: 1, faltante: { modo: "traer", desde: ZEL } }], pagoTr);
    igual("Sin stock (traer): vende al precio de lista", v1.total, pc(17500, "transferencia"));
    igual("Sin stock (traer): baja en Zelarrayan, queda 0 aca", [await stockDe(D, ZEL), await stockDe(D, LOCAL)], [2, 0]);
    await debeFallar("Sin stock (traer): no pasa mas de lo que hay alla", () => repo.registrarVenta(LOCAL, [{ sku: D, cant: 5, faltante: { modo: "traer", desde: ZEL } }], pagoTr), /no alcanza/);
    await debeFallar("Sin stock (traer): no desde el mismo local", () => repo.registrarVenta(LOCAL, [{ sku: D, cant: 1, faltante: { modo: "traer", desde: LOCAL } }], pagoTr), /inválidos/);
    // No estaba cargada en ningun lado: se suma y se vende
    const v2 = await repo.registrarVenta(LOCAL, [{ sku: D, cant: 2, faltante: { modo: "sin_cargar" } }], pagoTr);
    igual("Sin cargar: vende 2", v2.items[0].cant, 2);
    igual("Sin cargar: el stock queda en 0 (se sumo y se vendio)", await stockDe(D, LOCAL), 0);
    const movs = await pool.query<{ tipo: string; n: number }>(
      "select tipo::text as tipo, sum(cantidad)::int as n from movimientos where sku = $1 and motivo like 'Venta sin stock%' group by 1 order by 1", [D]);
    igual("Sin stock: queda registrado (traslado 1, ajuste 2)", movs.rows, [{ tipo: "ajuste", n: 2 }, { tipo: "traslado", n: 1 }]);
    const ctl = await (await import("../lib/cierre")).controlDiario(hoy, LOCAL);
    check("Sin stock: aparece en el informe de control", ctl.ajustesDeStock.some((a) => a.sku === D && (a.motivo ?? "").startsWith("Venta sin stock")), JSON.stringify(ctl.ajustesDeStock.slice(-3)));
    // Prenda que no existe en el sistema
    const precio = 12000 + Number(sello.slice(-3));
    const nueva = await repo.productoSinCargar({ nombre: `ZZ remera basquet ${sello}`, precio });
    igual("Prenda sin cargar: se crea sin stock y con su categoria", [nueva.tipo, Object.values(nueva.stock).reduce((a, b) => a + b, 0)], ["REM", 0]);
    const otra = await repo.productoSinCargar({ nombre: `ZZ remera basquet ${sello}`, precio });
    igual("Prenda sin cargar: la segunda vez usa la misma", otra.sku, nueva.sku);
    const v3 = await repo.registrarVenta(LOCAL, [{ sku: nueva.sku, cant: 1, faltante: { modo: "sin_cargar" } }], pagoTr);
    igual("Prenda sin cargar: se vende con su precio", v3.total, pc(precio, "transferencia"));
    await debeFallar("Prenda sin cargar: sin precio no", () => repo.productoSinCargar({ nombre: "ZZ algo", precio: 0 }), /precio/);
    // Buscar por precio
    check("Buscar por precio encuentra la prenda", (await repo.listar({ q: String(precio) })).some((x) => x.sku === nueva.sku), String(precio));
  });

  // ---- 9. Controles sobre TODA la base (datos reales incluidos) ----
  await paso("Controles de toda la base", async () => {
    const q = async (sql: string) => (await pool.query<{ n: number }>(sql)).rows[0].n;
    igual("Toda venta: pagos = total", await q(`select count(*)::int as n from ventas v
      where v.total <> (select coalesce(sum(monto), 0) from venta_pagos p where p.venta_id = v.id)`), 0);
    igual("Toda venta: lista = suma de prendas", await q(`select count(*)::int as n from ventas v
      where v.subtotal_lista <> (select coalesce(sum(precio_lista * cantidad), 0) from venta_items i where i.venta_id = v.id)`), 0);
    igual("Toda nota: saldo entre 0 y lo emitido", await q("select count(*)::int as n from notas_credito where saldo < 0 or saldo > monto_inicial"), 0);
    igual("Ningun stock negativo", await q("select count(*)::int as n from stock where cantidad < 0"), 0);
    igual("Traslados: recibido <= enviado", await q("select count(*)::int as n from traslados where cantidad_recibida > cantidad"), 0);
  });
} catch (e) {
  check("Pruebas", false, `ERROR: ${(e as Error).message}`);
} finally {
  if (promosReales.length) await pool.query("update promos set activa = true where id = any($1)", [promosReales]).catch(() => {});
}
await pool.end();

// ---- Resultado ----
const mal = filas.filter((f) => !f.ok);
const ancho = Math.max(...filas.map((f) => f.prueba.length));
console.log(`\nPruebas contra la copia de pruebas (${hoy}, local ${LOCAL}, prendas ZZ Prueba ... ${sello})\n`);
for (const f of filas) console.log(`${f.ok ? " OK " : " MAL"}  ${f.prueba.padEnd(ancho)}${f.ok ? "" : "  -> " + f.detalle}`);
console.log(`\n${filas.length - mal.length} OK, ${mal.length} MAL.`);
console.log("La copia quedo con datos ZZ de prueba: para dejarla igual a la real, npm run staging:refrescar\n");
process.exit(mal.length ? 1 : 0);

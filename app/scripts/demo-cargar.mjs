// Carga un stock FICTICIO para ver el sistema con datos. Se borra con: npm run demo:borrar
// Uso: npm run demo:cargar                 (con 18 ventas de ejemplo)
//      npm run demo:cargar -- --sin-ventas (solo stock, sin ventas hechas)
// Se niega a correr si ya hay productos, salvo --forzar.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("Falta DATABASE_URL"); process.exit(1); }

const norm = (s) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
let semilla = 20261005;
const azar = () => { semilla |= 0; semilla = (semilla + 0x6d2b79f5) | 0; let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const entre = (a, b) => a + Math.floor(azar() * (b - a + 1));

const DEP = "deposito";
const LOCALES = ["zelarrayan", "white", "sanlorenzo"];
const SEMANAS = ["2026-09-24T10:30:00-03:00", "2026-10-01T10:30:00-03:00"];

// [codigo, categoria, nombre, precio, cantidad total, recarga en la 2.a fecha (0 = no)]
const CATALOGO = [
  ["JEA", "Jean", "Jean wide leg dama", 17500, 40, 20], ["JEA", "Jean", "Jean recto hombre", 30000, 25, 0],
  ["JEA", "Jean", "Jean mom azul", 19500, 30, 0], ["JEA", "Jean", "Jean cargo hombre", 32000, 12, 0], ["JEA", "Jean", "Jean roto dama", 21000, 18, 0],
  ["REM", "Remera", "Remera oversize lisa", 9000, 60, 30], ["REM", "Remera", "Remera oversize estampada", 12000, 40, 0],
  ["REM", "Remera", "Remera básica algodón", 6500, 80, 40], ["REM", "Remera", "Remera crop dama", 8000, 35, 0],
  ["BUZ", "Buzo", "Buzo canguro friza", 24000, 30, 0], ["BUZ", "Buzo", "Buzo oversize rústico", 26000, 20, 0], ["BUZ", "Buzo", "Buzo cuello redondo", 18000, 25, 0],
  ["CAM", "Campera", "Campera boxyfit algodón", 29000, 15, 0], ["CAM", "Campera", "Campera rompeviento", 35000, 10, 0],
  ["CAM", "Campera", "Campera de jean", 38000, 8, 0], ["CAM", "Campera", "Campera puffer", 52000, 6, 0],
  ["PAN", "Pantalón", "Pantalón de gabardina", 22000, 25, 12], ["PAN", "Pantalón", "Pantalón cargo", 28000, 18, 0],
  ["PAN", "Pantalón", "Pantalón jogger friza", 20000, 30, 0], ["PAN", "Pantalón", "Pantalón de vestir", 25000, 12, 0],
  ["SHO", "Short", "Short de baño", 11000, 30, 0], ["SHO", "Short", "Bermuda cargo", 17000, 20, 0], ["SHO", "Short", "Short deportivo", 9500, 35, 0],
  ["VES", "Vestido", "Vestido midi floral", 26000, 14, 0], ["VES", "Vestido", "Vestido corto negro", 23000, 10, 0],
  ["POL", "Pollera", "Pollera plisada", 18000, 12, 0],
];
const NUEVAS = { VES: ["Vestido", ["vestido", "vestidos"]], POL: ["Pollera", ["pollera", "polleras"]] };

const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  const hay = await c.query("select (select count(*) from productos)::int as p");
  if (hay.rows[0].p > 0 && !process.argv.includes("--forzar")) {
    console.error(`Ya hay ${hay.rows[0].p} productos cargados. No se carga el stock ficticio (usá --forzar si estás seguro).`);
    process.exit(1);
  }
  const medios = Object.fromEntries((await c.query("select id, ajuste_pct::float8 as pct from medios_pago where activo")).rows.map((m) => [m.id, m.pct]));
  await c.query("begin");

  for (const [cod, [nombre, alias]] of Object.entries(NUEVAS)) {
    await c.query("insert into tipos (codigo, nombre, alias) values ($1, $2, $3) on conflict do nothing", [cod, nombre, alias]);
    await c.query("insert into contadores_sku (tipo) values ($1) on conflict do nothing", [cod]);
  }

  const stock = (sku, suc, d) => c.query(
    `insert into stock (sku, sucursal_id, cantidad) values ($1, $2, $3)
     on conflict (sku, sucursal_id) do update set cantidad = stock.cantidad + excluded.cantidad`, [sku, suc, d]);
  const mov = (sku, cant, desde, hasta, tipo, fecha, extra = {}) => c.query(
    "insert into movimientos (creado_en, sku, cantidad, desde, hasta, tipo, motivo, venta_id) values ($1, $2, $3, $4, $5, $6, $7, $8)",
    [fecha, sku, cant, desde, hasta, tipo, extra.motivo ?? null, extra.ventaId ?? null]);

  const productos = [];
  // 1) Productos y cargas (algunos con recarga en la segunda fecha)
  for (const [cod, , nombre, precio, cant, recarga] of CATALOGO) {
    const n = (await c.query("update contadores_sku set ultimo = ultimo + 1 where tipo = $1 returning ultimo", [cod])).rows[0].ultimo;
    const sku = cod + String(n).padStart(6, "0");
    const primera = recarga ? cant - recarga : cant;
    const f1 = recarga ? SEMANAS[0] : SEMANAS[entre(0, 1)];
    await c.query("insert into productos (sku, tipo, nombre, nombre_norm, precio_lista, creado_en) values ($1, $2, $3, $4, $5, $6)", [sku, cod, nombre, norm(nombre), precio, f1]);
    const cargas = [[primera, f1]];
    if (recarga) cargas.push([recarga, SEMANAS[1]]);
    for (const [q, f] of cargas) {
      await c.query("insert into cargas (sku, cantidad, creado_en) values ($1, $2, $3)", [sku, q, f]);
      await stock(sku, DEP, q);
      await mov(sku, q, null, DEP, "carga", f);
    }
    productos.push({ sku, nombre, precio, cant, fecha: cargas.at(-1)[1], stock: { [DEP]: cant, zelarrayan: 0, white: 0, sanlorenzo: 0 } });
  }

  // 2) Reparto a los locales: casi todo recibido, y algunos envios todavia en camino
  let pendientes = 0;
  for (const [i, p] of productos.entries()) {
    const fEnvio = SEMANAS[1];
    const partes = { zelarrayan: Math.floor(p.cant * 0.3), white: Math.floor(p.cant * 0.3), sanlorenzo: Math.floor(p.cant * 0.15) };
    for (const [dest, n] of Object.entries(partes)) {
      if (n <= 0) continue;
      const enCamino = dest === "sanlorenzo" && i % 5 === 0;
      await stock(p.sku, DEP, -n);
      p.stock[DEP] -= n;
      await c.query(
        `insert into traslados (creado_en, sku, cantidad, cantidad_recibida, desde, hasta, estado, recibido_en)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [fEnvio, p.sku, n, enCamino ? 0 : n, DEP, dest, enCamino ? "en_camino" : "recibido", enCamino ? null : "2026-10-02T11:00:00-03:00"]);
      await mov(p.sku, n, DEP, dest, "envio", fEnvio);
      if (enCamino) { pendientes += n; p.enCamino = (p.enCamino ?? 0) + n; continue; }
      await stock(p.sku, dest, n);
      p.stock[dest] += n;
      await mov(p.sku, n, DEP, dest, "recepcion", "2026-10-02T11:00:00-03:00");
    }
  }

  // 3) Ventas de los ultimos dias (varias hoy, para ver la caja del dia)
  const ahora = Date.now();
  const pesosMedio = ["efectivo", "efectivo", "transferencia", "transferencia", "tarjeta"];
  let nVentas = 0;
  const cuantas = process.argv.includes("--sin-ventas") ? 0 : 18;
  for (let k = 0; k < cuantas; k++) {
    const suc = LOCALES[entre(0, 2)];
    const hoy = k < 9;
    const fecha = new Date(ahora - (hoy ? entre(0, 5) * 3600e3 : entre(1, 5) * 86400e3)).toISOString();
    const lineas = [];
    for (let j = entre(1, 4); j > 0; j--) {
      const cand = productos.filter((p) => p.stock[suc] >= 2 && !lineas.some((l) => l.p.sku === p.sku));
      if (!cand.length) break;
      lineas.push({ p: cand[entre(0, cand.length - 1)], cant: entre(1, 2) });
    }
    if (!lineas.length) continue;
    const medio = pesosMedio[entre(0, pesosMedio.length - 1)];
    const subtotal = lineas.reduce((s, l) => s + l.p.precio * l.cant, 0);
    const total = Math.round(subtotal * (1 + medios[medio] / 100));
    const v = await c.query(
      `insert into ventas (creado_en, sucursal_id, subtotal_lista, medio_pago_id, ajuste_medio_pago, ajuste_pct_usado, total)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`, [fecha, suc, subtotal, medio, total - subtotal, medios[medio], total]);
    const ventaId = Number(v.rows[0].id);
    await c.query("insert into venta_pagos (venta_id, medio_pago_id, monto, valor_lista, ajuste_pct_usado) values ($1, $2, $3, $4, $5)", [ventaId, medio, total, subtotal, medios[medio]]);
    for (const l of lineas) {
      await c.query("insert into venta_items (venta_id, sku, nombre, precio_lista, cantidad) values ($1, $2, $3, $4, $5)", [ventaId, l.p.sku, l.p.nombre, l.p.precio, l.cant]);
      await stock(l.p.sku, suc, -l.cant);
      l.p.stock[suc] -= l.cant;
      await mov(l.p.sku, l.cant, suc, null, "venta", fecha, { ventaId });
    }
    nVentas++;
  }

  await c.query("commit");
  writeFileSync(join(process.cwd(), "scripts", "demo-skus.json"), JSON.stringify(productos.map((p) => p.sku)));
  const unid = productos.reduce((s, p) => s + Object.values(p.stock).reduce((a, b) => a + b, 0), 0);
  console.log(`Stock ficticio cargado: ${productos.length} productos, ${unid} prendas en stock, ${pendientes} en camino, ${nVentas} ventas.`);
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("ERROR:", e.message);
  process.exit(1);
} finally {
  await c.end();
}

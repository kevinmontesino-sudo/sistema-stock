// Borra el stock ficticio cargado con demo-cargar (usa la lista scripts/demo-skus.json).
// Solo toca esos productos y sus ventas, movimientos y envios. Si no queda ningun producto, reinicia los contadores de SKU.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("Falta DATABASE_URL"); process.exit(1); }
let skus;
try { skus = JSON.parse(readFileSync(join(process.cwd(), "scripts", "demo-skus.json"), "utf8")); }
catch { console.error("No hay lista de productos ficticios (scripts/demo-skus.json). No se borra nada."); process.exit(1); }

const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  await c.query("begin");
  await c.query("delete from traslados where sku = any($1)", [skus]);
  const ventas = await c.query("select distinct venta_id from venta_items where sku = any($1)", [skus]);
  const ids = ventas.rows.map((r) => r.venta_id);
  await c.query("delete from movimientos where sku = any($1) or venta_id = any($2)", [skus, ids]);
  await c.query("delete from venta_pagos where venta_id = any($1)", [ids]);
  await c.query("delete from venta_items where venta_id = any($1)", [ids]);
  await c.query("delete from ventas where id = any($1)", [ids]);
  await c.query("delete from stock where sku = any($1)", [skus]);
  await c.query("delete from cargas where sku = any($1)", [skus]);
  await c.query("delete from productos where sku = any($1)", [skus]);
  // Categorias que creo la demo: primero su contador (referencia a tipos) y despues la categoria.
  const sinUso = "('VES','POL') and not exists (select 1 from productos p where p.tipo = %T)";
  await c.query(`delete from contadores_sku where tipo in ${sinUso.replace("%T", "contadores_sku.tipo")}`);
  await c.query(`delete from tipos where codigo in ${sinUso.replace("%T", "tipos.codigo")}`);
  const quedan = (await c.query("select count(*)::int as n from productos")).rows[0].n;
  if (quedan === 0) {
    await c.query("update contadores_sku set ultimo = 0");
    for (const t of ["traslados", "movimientos", "venta_items", "ventas", "cargas"]) await c.query(`alter table ${t} alter column id restart with 1`);
  }
  await c.query("commit");
  console.log(`Stock ficticio borrado (${skus.length} productos). Productos que quedan: ${quedan}.`);
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("ERROR:", e.message);
  process.exit(1);
} finally {
  await c.end();
}

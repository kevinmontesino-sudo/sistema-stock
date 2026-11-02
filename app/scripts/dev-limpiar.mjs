// Deja la base de PRUEBAS sin prendas, ventas ni envios (conserva sucursales, categorias, medios de pago y usuarios de prueba).
// Solo funciona contra la base local sistema_stock_dev: si DATABASE_URL apunta a otra cosa, se niega. Uso: npm run dev:limpiar
import pg from "pg";

const url = process.env.DATABASE_URL ?? "";
const u = (() => { try { return new URL(url); } catch { return null; } })();
if (!u || !["127.0.0.1", "localhost"].includes(u.hostname) || u.port === "15432" || u.pathname !== "/sistema_stock_dev") {
  console.error("Me niego: esto solo se puede correr contra la base de pruebas local (127.0.0.1:5432/sistema_stock_dev).");
  process.exit(1);
}
const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  await c.query("begin");
  await c.query("set local app.mantenimiento = 'on'");
  for (const t of ["movimientos", "venta_pagos", "nota_credito_items", "notas_credito", "venta_items", "ventas", "traslados", "stock", "cargas", "productos", "auditoria", "intentos_login", "sesiones", "tokens_api"])
    await c.query(`delete from ${t}`);
  await c.query("update contadores_sku set ultimo = 0");
  for (const t of ["traslados", "movimientos", "venta_items", "ventas", "cargas", "notas_credito"]) await c.query(`alter table ${t} alter column id restart with 1`).catch(() => {});
  await c.query("commit");
  console.log("Base de pruebas limpia.");
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("ERROR:", e.message);
  process.exit(1);
} finally {
  await c.end();
}

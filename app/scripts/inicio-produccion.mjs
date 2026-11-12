// Deja la base REAL en cero para empezar a operar: borra prendas, stock, ventas, notas, envios, cierres y auditoria.
// CONSERVA: usuarios, sucursales, categorias, medios de pago, promos, tokens de la API.
// Uso (desde la carpeta app):  set -a && . ./.env.prod.local && node scripts/inicio-produccion.mjs
// Pide escribir una frase de confirmacion. Antes hace un respaldo: corre `npm run respaldo` si lo tenes configurado.
import pg from "pg";
import readline from "node:readline/promises";

const url = process.env.DATABASE_URL ?? "";
if (!url) { console.error("Falta DATABASE_URL (cargá .env.prod.local)."); process.exit(1); }
const u = new URL(url);
const c = new pg.Client({ connectionString: url });
await c.connect();

const BORRAR = ["cierres_caja", "movimientos", "venta_pagos", "nota_credito_items", "notas_credito", "ventas_anuladas", "venta_items", "ventas", "traslados", "stock", "cargas", "productos", "auditoria", "intentos_login"];
console.log(`Base: ${u.hostname}:${u.port}${u.pathname}\n`);
for (const t of BORRAR) console.log(`  ${t.padEnd(20)} ${(await c.query(`select count(*)::int n from ${t}`)).rows[0].n} filas`);
const us = await c.query("select email, rol, activo from usuarios order by id");
console.log("\nSe conservan estos usuarios:");
for (const x of us.rows) console.log(`  ${x.email} (${x.rol})${x.activo ? "" : " [inactivo]"}`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const r = await rl.question('\nEsto NO se puede deshacer. Para seguir escribí exactamente BORRAR TODO: ');
rl.close();
if (r.trim() !== "BORRAR TODO") { console.log("Cancelado. No se tocó nada."); await c.end(); process.exit(0); }

try {
  await c.query("begin");
  await c.query("set local app.mantenimiento = 'on'");
  for (const t of BORRAR) await c.query(`delete from ${t}`);
  await c.query("update contadores_sku set ultimo = 0");
  for (const t of ["traslados", "movimientos", "venta_items", "ventas", "cargas", "notas_credito", "cierres_caja"]) await c.query(`alter table ${t} alter column id restart with 1`).catch(() => {});
  await c.query("commit");
  console.log("\nListo: base en cero. Ya se puede cargar mercadería.");
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("ERROR (no se borró nada):", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}

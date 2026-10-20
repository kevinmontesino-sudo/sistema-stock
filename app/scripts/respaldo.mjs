// Respaldo manual: guarda todas las tablas del stock en un archivo JSON con fecha.
// Solo LEE de la base. Uso: npm run respaldo
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL (se carga desde .env.local con npm run respaldo).");
  process.exit(1);
}

// Todas las tablas de negocio. De "usuarios" NO se copian las contrasenas (hash) ni los secretos de la doble verificacion, y
// no se copian las sesiones ni los intentos de login: el respaldo no debe servir para entrar al sistema.
const TABLAS = ["sucursales", "tipos", "usuarios", "productos", "contadores_sku", "stock", "cargas", "movimientos", "traslados", "medios_pago",
  "ventas", "venta_items", "venta_pagos", "notas_credito", "nota_credito_items", "auditoria"];
const COLUMNAS_SECRETAS = { usuarios: ["password_hash", "totp_secreto", "totp_ultimo_paso"] };
const carpeta = join(process.cwd(), "..", "respaldos");
mkdirSync(carpeta, { recursive: true });

const c = new pg.Client({ connectionString: url });
await c.connect();
const datos = {};
let filas = 0;
try {
  await c.query("begin transaction isolation level repeatable read read only");
  for (const t of TABLAS) {
    const r = await c.query(`select * from ${t}`);
    for (const col of COLUMNAS_SECRETAS[t] ?? []) for (const fila of r.rows) delete fila[col];
    datos[t] = r.rows;
    filas += r.rows.length;
  }
  await c.query("commit");
} finally {
  await c.end();
}

const sello = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const archivo = join(carpeta, `stock-${sello}.json`);
writeFileSync(archivo, JSON.stringify({ generado: new Date().toISOString(), tablas: datos }, null, 1), { mode: 0o600 });
console.log(`Respaldo listo: ${archivo} (${filas} filas en ${TABLAS.length} tablas)`);

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

const TABLAS = ["sucursales", "tipos", "usuarios", "productos", "contadores_sku", "stock", "cargas", "movimientos", "traslados", "medios_pago", "ventas", "venta_items"];
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

#!/usr/bin/env node
// Aplica un archivo de migracion (db/NNN_*.sql) a la base que diga el archivo de entorno y muestra a que base lo aplico.
// Las migraciones se pueden correr mas de una vez. Orden: primero la base REAL, despues el despliegue (ver la nota "migracion antes de desplegar").
// Uso (desde app/):  node --env-file=.env.local        scripts/aplicar-migracion.mjs ../db/031_x.sql   (desarrollo)
//                    node --env-file=.env.staging.local scripts/aplicar-migracion.mjs ../db/031_x.sql   (copia de pruebas)
//                    node --env-file=.env.prod.local    scripts/aplicar-migracion.mjs ../db/031_x.sql   (REAL, por el tunel)
import { readFileSync } from "node:fs";
import pg from "pg";

const archivo = process.argv[2];
if (!archivo) { console.error("Falta el archivo .sql"); process.exit(1); }
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(readFileSync(archivo, "utf8"));
  const db = await pool.query("select current_database() as db");
  console.log(`Aplicada ${archivo} en la base ${db.rows[0].db}`);
} catch (e) {
  console.error("ERROR:", e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}

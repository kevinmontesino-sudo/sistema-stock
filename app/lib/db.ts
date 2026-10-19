import { Pool, type PoolClient } from "pg";

const g = globalThis as unknown as { __stockPool?: Pool };

export const pool =
  g.__stockPool ?? (g.__stockPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 8000, // si no hay conexion libre en 8 s, falla con un error claro en vez de colgar la caja
    idleTimeoutMillis: 30000,
    statement_timeout: 15000, // ninguna consulta puede tener trabada la caja mas de 15 s
    lock_timeout: 8000, // ni esperar un bloqueo de otra venta por mas de 8 s
  }));

export type Db = Pool | PoolClient;

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

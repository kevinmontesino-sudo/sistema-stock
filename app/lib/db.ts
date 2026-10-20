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

// Si se corta una conexion que estaba quieta (se cayo la red o el tunel), pg avisa con un evento "error".
// Sin este manejador Node lo toma como error no atendido y se cae todo el servidor; asi solo se descarta esa conexion.
if (!pool.listenerCount("error")) pool.on("error", (e) => console.error("[db] conexion perdida:", e.message));

export type Db = Pool | PoolClient;

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  let r: T;
  try {
    await c.query("begin");
    r = await fn(c);
    await c.query("commit");
  } catch (e) {
    // Si la conexion se murio, el rollback tambien falla: se informa el error original y la conexion se descarta.
    const rota = await c.query("rollback").then(() => false, () => true);
    c.release(rota);
    throw e;
  }
  c.release();
  return r;
}

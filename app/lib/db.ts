import { Pool, type PoolClient } from "pg";

const g = globalThis as unknown as { __stockPool?: Pool };

export const pool =
  g.__stockPool ?? (g.__stockPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 }));

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

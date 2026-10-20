import { createHash, randomBytes } from "node:crypto";
import { pool } from "../db";

// Llaves de acceso para la API de informes (solo lectura). Formato: xmp_ + 43 caracteres al azar (256 bits).
// En la base solo se guarda la huella (sha256): si se filtra la base, las llaves no sirven.
export const PREFIJO_TOKEN = "xmp_";
export const huellaToken = (t: string) => createHash("sha256").update(t).digest("hex");

export async function crearToken(nombre: string, dias: number, creadoPor: number) {
  const token = PREFIJO_TOKEN + randomBytes(32).toString("base64url");
  const r = await pool.query<{ id: number; vence: Date }>(
    `insert into tokens_api (nombre, token_hash, prefijo, creado_por, vence_en)
     values ($1, $2, $3, $4, now() + ($5 || ' days')::interval) returning id::int as id, vence_en as vence`,
    [nombre, huellaToken(token), token.slice(0, 10), creadoPor, String(dias)],
  );
  return { token, id: r.rows[0].id, vence: new Date(r.rows[0].vence).toISOString() };
}

// Devuelve la llave si es valida (existe, no vencio, no esta revocada) y registra el uso.
export async function verificarToken(encabezado: string | null) {
  const m = encabezado?.match(/^Bearer\s+(\S+)$/i);
  const token = m?.[1];
  if (!token || !token.startsWith(PREFIJO_TOKEN) || token.length < 30 || token.length > 80) return null;
  const r = await pool.query<{ id: number; nombre: string }>(
    `update tokens_api set ultimo_uso = now(), usos = usos + 1
     where token_hash = $1 and revocado_en is null and vence_en > now() returning id::int as id, nombre`,
    [huellaToken(token)],
  );
  return r.rows[0] ?? null;
}

// Limite de pedidos por llave: 30 por minuto (en memoria; alcanza con una sola instancia de la app).
const ventanas = new Map<number, { desde: number; n: number }>();
export function permitirPedido(id: number, ahora = Date.now()) {
  const v = ventanas.get(id);
  if (!v || ahora - v.desde > 60_000) { ventanas.set(id, { desde: ahora, n: 1 }); return true; }
  v.n++;
  return v.n <= 30;
}

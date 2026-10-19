import { pool } from "../db";

// Limite de intentos fallidos: 5 por usuario y 30 por IP en 15 minutos.
const VENTANA = "15 minutes";

export async function demasiadosIntentos(emailNorm: string, ip: string | null) {
  const r = await pool.query<{ por_email: number; por_ip: number }>(
    `select
       (select count(*)::int from intentos_login where email_norm = $1 and not ok and creado_en > now() - interval '${VENTANA}'
          and creado_en > coalesce((select max(creado_en) from intentos_login where email_norm = $1 and ok), '-infinity')) as por_email,
       (select count(*)::int from intentos_login where ip = $2 and not ok and creado_en > now() - interval '${VENTANA}') as por_ip`,
    [emailNorm, ip],
  );
  return r.rows[0].por_email >= 5 || r.rows[0].por_ip >= 30;
}

export const registrarIntento = (emailNorm: string, ip: string | null, ok: boolean) =>
  pool.query("insert into intentos_login (email_norm, ip, ok) values ($1, $2, $3)", [emailNorm, ip, ok]);

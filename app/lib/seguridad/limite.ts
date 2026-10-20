import { pool } from "../db";

// Limites de intentos fallidos en 15 minutos: 5 por usuario desde la misma IP, 15 por usuario en total (ataque desde varias
// IP) y 30 por IP. Asi alguien que conoce el email de gerencia no puede dejarlo afuera tan facil: tendria que pegarle desde
// muchas IP distintas.
const VENTANA = "15 minutes";

export async function demasiadosIntentos(emailNorm: string, ip: string | null) {
  const r = await pool.query<{ por_email_ip: number; por_email: number; por_ip: number }>(
    `select
       (select count(*)::int from intentos_login where email_norm = $1 and ip is not distinct from $2 and not ok and creado_en > now() - interval '${VENTANA}'
          and creado_en > coalesce((select max(creado_en) from intentos_login where email_norm = $1 and ip is not distinct from $2 and ok), '-infinity')) as por_email_ip,
       (select count(*)::int from intentos_login where email_norm = $1 and not ok and creado_en > now() - interval '${VENTANA}'
          and creado_en > coalesce((select max(creado_en) from intentos_login where email_norm = $1 and ok), '-infinity')) as por_email,
       (select count(*)::int from intentos_login where ip = $2 and not ok and creado_en > now() - interval '${VENTANA}') as por_ip`,
    [emailNorm, ip],
  );
  const x = r.rows[0];
  return x.por_email_ip >= 5 || x.por_email >= 15 || x.por_ip >= 30;
}

export const registrarIntento = (emailNorm: string, ip: string | null, ok: boolean) =>
  pool.query("insert into intentos_login (email_norm, ip, ok) values ($1, $2, $3)", [emailNorm, ip, ok]);

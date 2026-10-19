import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { pool } from "../db";
import type { Rol } from "./permisos";
import type { UsuarioSesion } from "./contexto";

// Sesiones guardadas en la base: el navegador solo lleva un token al azar (cookie httpOnly) y aca queda su huella.
// Se pueden cerrar desde el servidor en cualquier momento (cambio de clave, usuario desactivado, etc.).
export const COOKIE = process.env.NODE_ENV === "production" ? "__Host-sesion" : "sesion";
const HORA = 3600;
// Duracion maxima y tiempo sin actividad, en segundos. Los administradores tienen sesiones mas cortas.
const POLITICA = {
  admin: { absoluta: 8 * HORA, inactividad: 2 * HORA },
  otros: { absoluta: 14 * HORA, inactividad: 6 * HORA },
  pendiente: { absoluta: 10 * 60, inactividad: 10 * 60 }, // entre la clave y el codigo de doble verificacion
};
export type Fase = "2fa_pendiente" | "2fa_alta" | "activa";
const politica = (rol: Rol, fase: Fase) => (fase !== "activa" ? POLITICA.pendiente : rol === "admin" ? POLITICA.admin : POLITICA.otros);

export const huella = (token: string) => createHash("sha256").update(token).digest("hex");

export async function ipDelPedido() {
  const h = await headers();
  // Detras del proxy de Easypanel (Traefik) la IP real viene en x-forwarded-for; se toma la primera.
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || null;
}

export async function crearSesion(usuarioId: number, rol: Rol, fase: Fase) {
  const token = randomBytes(32).toString("base64url");
  const pol = politica(rol, fase);
  const h = await headers();
  await pool.query("delete from sesiones where expira_en < now()"); // limpieza de paso
  await pool.query(
    `insert into sesiones (token_hash, usuario_id, fase, expira_en, ip, user_agent)
     values ($1, $2, $3, now() + ($4 || ' seconds')::interval, $5, $6)`,
    [huella(token), usuarioId, fase, String(pol.absoluta), await ipDelPedido(), (h.get("user-agent") ?? "").slice(0, 300)],
  );
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: pol.absoluta,
  });
}

export type SesionActual = { id: number; fase: Fase; usuario: UsuarioSesion };

// Sesion del pedido en curso (cualquier fase). Se consulta una vez por pedido.
export const sesionActual = cache(async (): Promise<SesionActual | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || token.length < 20 || token.length > 100) return null;
  const r = await pool.query<{
    id: number; fase: Fase; ultima: Date; uid: number; nombre: string; email: string; rol: Rol; sucursal: string | null;
    totp: boolean; cambiar: boolean; inactiva: number;
  }>(
    `select s.id::int as id, s.fase, s.ultima_actividad as ultima, extract(epoch from now() - s.ultima_actividad)::int as inactiva,
       u.id::int as uid, u.nombre, u.email, u.rol, u.sucursal_id as sucursal, u.totp_activo as totp, u.debe_cambiar_clave as cambiar
     from sesiones s join usuarios u on u.id = s.usuario_id
     where s.token_hash = $1 and u.activo and s.expira_en > now()`,
    [huella(token)],
  );
  const s = r.rows[0];
  if (!s) return null;
  if (s.inactiva > politica(s.rol, s.fase).inactividad) {
    await pool.query("delete from sesiones where id = $1", [s.id]);
    return null;
  }
  if (s.inactiva > 60) await pool.query("update sesiones set ultima_actividad = now() where id = $1", [s.id]);
  return {
    id: s.id, fase: s.fase,
    usuario: { id: s.uid, nombre: s.nombre, email: s.email, rol: s.rol, sucursalId: s.sucursal, totpActivo: s.totp, debeCambiarClave: s.cambiar },
  };
});

// Usuario con la sesion completa (clave y, si corresponde, doble verificacion ya hechas).
export async function usuarioActual() {
  const s = await sesionActual();
  return s && s.fase === "activa" ? s.usuario : null;
}

export async function activarSesion(sesionId: number) {
  await pool.query("update sesiones set fase = 'activa', ultima_actividad = now(), expira_en = now() + interval '14 hours' where id = $1", [sesionId]);
}

export async function cerrarSesion() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await pool.query("delete from sesiones where token_hash = $1", [huella(token)]);
  jar.delete(COOKIE);
}

export const cerrarSesionesDe = (usuarioId: number, salvo?: number) =>
  pool.query("delete from sesiones where usuario_id = $1 and ($2::bigint is null or id <> $2)", [usuarioId, salvo ?? null]);

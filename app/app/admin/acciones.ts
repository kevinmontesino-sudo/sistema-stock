"use server";
import { randomInt } from "node:crypto";
import { pool } from "@/lib/db";
import { ErrorNegocio } from "@/lib/repo";
import { auditar } from "@/lib/seguridad/auditoria";
import { conUsuario } from "@/lib/seguridad/contexto";
import { hashClave } from "@/lib/seguridad/clave";
import { cerrarSesionesDe, ipDelPedido, usuarioActual } from "@/lib/seguridad/sesion";
import { puede, ROLES, type Rol } from "@/lib/seguridad/permisos";
import { empresa } from "@/lib/empresa.config";

// Acciones del panel de administracion: SOLO administradores (se verifica en cada una, no en la pantalla).
type Resultado<T> = ({ ok: true } & T) | { ok: false; motivo: string };
const txt = (v: unknown) => (typeof v === "string" ? v : "");

async function admin<T extends object>(fn: (yo: NonNullable<Awaited<ReturnType<typeof usuarioActual>>>) => Promise<T>): Promise<Resultado<T>> {
  const yo = await usuarioActual();
  if (!yo) return { ok: false, motivo: "Tu sesión venció. Volvé a iniciar sesión." };
  if (!puede(yo.rol, "admin")) {
    await auditar("acceso_denegado", { permiso: "admin" }, { usuarioId: yo.id, email: yo.email }).catch(() => {});
    return { ok: false, motivo: "No tenés permiso para hacer esto." };
  }
  try {
    return { ok: true, ...(await conUsuario(yo, await ipDelPedido(), () => fn(yo))) }; // asi la auditoria sabe quien fue
  } catch (e) {
    if (e instanceof ErrorNegocio) return { ok: false, motivo: e.message };
    console.error("[admin]", e);
    return { ok: false, motivo: "No se pudo completar la operación." };
  }
}

// Contrasena temporal al azar (sin caracteres que se confundan). Se muestra una sola vez y obliga a cambiarla al entrar.
function claveTemporal() {
  const a = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const pick = (s: string) => s[randomInt(s.length)];
  const base = Array.from({ length: 12 }, () => pick(a));
  base.splice(randomInt(13), 0, pick("23456789"), pick("ABCDEFGHJKLMNPQRSTUVWXYZ"));
  return `${base.join("")}-${pick("!#$%&*+?")}`;
}

export type UsuarioFila = {
  id: number; nombre: string; email: string; rol: Rol; sucursalId: string | null; activo: boolean; totpActivo: boolean;
  ultimoLogin: string | null; debeCambiarClave: boolean;
};

export async function listarUsuarios() {
  return admin(async () => {
    const r = await pool.query<UsuarioFila>(
      `select id::int as id, nombre, email, rol, sucursal_id as "sucursalId", activo, totp_activo as "totpActivo",
         ultimo_login as "ultimoLogin", debe_cambiar_clave as "debeCambiarClave"
       from usuarios order by activo desc, rol, nombre`,
    );
    return { usuarios: r.rows.map((u) => ({ ...u, ultimoLogin: u.ultimoLogin ? new Date(u.ultimoLogin).toISOString() : null })) };
  });
}

function validarDatos(a: { nombre: string; email: string; rol: string; sucursalId: string }) {
  const nombre = a.nombre.trim();
  const email = a.email.trim().toLowerCase();
  if (nombre.length < 2 || nombre.length > 80) throw new ErrorNegocio("Escribí el nombre de la persona.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) throw new ErrorNegocio("El email no es válido.");
  if (!ROLES.includes(a.rol as Rol)) throw new ErrorNegocio("Elegí un rol válido.");
  const rol = a.rol as Rol;
  let sucursalId: string | null = a.sucursalId || null;
  if (rol === "vendedor" || rol === "encargado") {
    if (!sucursalId || !empresa.sucursales.some((s) => s.id === sucursalId && s.id !== "deposito")) throw new ErrorNegocio("Elegí el local en el que trabaja.");
  } else sucursalId = null;
  return { nombre, email, rol, sucursalId };
}

export async function crearUsuario(a: { nombre: string; email: string; rol: string; sucursalId: string }) {
  return admin(async () => {
    const d = validarDatos({ nombre: txt(a.nombre), email: txt(a.email), rol: txt(a.rol), sucursalId: txt(a.sucursalId) });
    const existe = await pool.query("select 1 from usuarios where lower(email) = $1", [d.email]);
    if (existe.rows.length) throw new ErrorNegocio("Ya existe un usuario con ese email.");
    const clave = claveTemporal();
    const r = await pool.query<{ id: number }>(
      "insert into usuarios (nombre, email, password_hash, rol, sucursal_id, debe_cambiar_clave) values ($1, $2, $3, $4, $5, true) returning id::int as id",
      [d.nombre, d.email, await hashClave(clave), d.rol, d.sucursalId],
    );
    await auditar("usuario_creado", { id: r.rows[0].id, email: d.email, rol: d.rol, sucursal: d.sucursalId });
    return { clave, email: d.email };
  });
}

export async function actualizarUsuario(id: number, a: { nombre: string; rol: string; sucursalId: string; activo: boolean }) {
  return admin(async (yo) => {
    const antes = (await pool.query<{ nombre: string; email: string; rol: Rol; sucursal_id: string | null; activo: boolean }>("select nombre, email, rol, sucursal_id, activo from usuarios where id = $1", [id])).rows[0];
    if (!antes) throw new ErrorNegocio("No existe ese usuario.");
    const d = validarDatos({ nombre: txt(a.nombre), email: antes.email, rol: txt(a.rol), sucursalId: txt(a.sucursalId) });
    const activo = !!a.activo;
    if (id === yo.id && (d.rol !== "admin" || !activo)) throw new ErrorNegocio("No podés sacarte a vos mismo el rol de administrador ni desactivarte.");
    if (antes.rol === "admin" && (d.rol !== "admin" || !activo)) {
      const otros = await pool.query("select 1 from usuarios where rol = 'admin' and activo and id <> $1", [id]);
      if (!otros.rows.length) throw new ErrorNegocio("Tiene que quedar al menos un administrador activo.");
    }
    await pool.query("update usuarios set nombre = $2, rol = $3, sucursal_id = $4, activo = $5 where id = $1", [id, d.nombre, d.rol, d.sucursalId, activo]);
    if (!activo || d.rol !== antes.rol || d.sucursalId !== antes.sucursal_id) await cerrarSesionesDe(id); // se aplica en el momento
    await auditar("usuario_actualizado", { id, email: antes.email, antes: { nombre: antes.nombre, rol: antes.rol, sucursal: antes.sucursal_id, activo: antes.activo }, despues: { nombre: d.nombre, rol: d.rol, sucursal: d.sucursalId, activo } });
    return {};
  });
}

export async function restablecerClave(id: number) {
  return admin(async () => {
    const u = (await pool.query<{ email: string }>("select email from usuarios where id = $1", [id])).rows[0];
    if (!u) throw new ErrorNegocio("No existe ese usuario.");
    const clave = claveTemporal();
    await pool.query("update usuarios set password_hash = $2, debe_cambiar_clave = true where id = $1", [id, await hashClave(clave)]);
    await cerrarSesionesDe(id);
    await auditar("clave_restablecida", { id, email: u.email });
    return { clave, email: u.email };
  });
}

export async function restablecerDobleVerificacion(id: number) {
  return admin(async (yo) => {
    if (id === yo.id) throw new ErrorNegocio("Tu propia doble verificación la reinicia otro administrador.");
    const u = (await pool.query<{ email: string }>("select email from usuarios where id = $1", [id])).rows[0];
    if (!u) throw new ErrorNegocio("No existe ese usuario.");
    await pool.query("update usuarios set totp_secreto = null, totp_activo = false, totp_ultimo_paso = null where id = $1", [id]);
    await cerrarSesionesDe(id);
    await auditar("2fa_reiniciado", { id, email: u.email });
    return {};
  });
}

export type FilaAuditoria = { id: number; fecha: string; usuario: string | null; accion: string; detalle: Record<string, unknown>; ip: string | null };

export async function listarAuditoria(f: { accion?: string; q?: string; pagina?: number }) {
  return admin(async () => {
    const params: unknown[] = [];
    const cond: string[] = [];
    if (txt(f.accion)) { params.push(txt(f.accion)); cond.push(`accion = $${params.length}`); }
    if (txt(f.q).trim()) { params.push(`%${txt(f.q).trim().toLowerCase()}%`); cond.push(`(lower(usuario_email) like $${params.length} or lower(detalle::text) like $${params.length})`); }
    const pagina = Math.max(0, Math.floor(Number(f.pagina) || 0));
    params.push(100, pagina * 100);
    const r = await pool.query<{ id: number; fecha: Date; usuario: string | null; accion: string; detalle: Record<string, unknown>; ip: string | null }>(
      `select id::int as id, creado_en as fecha, usuario_email as usuario, accion, detalle, ip from auditoria
       ${cond.length ? "where " + cond.join(" and ") : ""} order by id desc limit $${params.length - 1} offset $${params.length}`,
      params,
    );
    const acciones = await pool.query<{ accion: string }>("select distinct accion from auditoria order by 1");
    return { filas: r.rows.map((x) => ({ ...x, fecha: new Date(x.fecha).toISOString() })) as FilaAuditoria[], acciones: acciones.rows.map((a) => a.accion) };
  });
}

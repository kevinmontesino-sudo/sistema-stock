"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { pool } from "@/lib/db";
import { hashClave, hashDeRelleno, validarClaveNueva, verificarClave } from "@/lib/seguridad/clave";
import { auditar } from "@/lib/seguridad/auditoria";
import { destinoSeguro } from "@/lib/seguridad/guardia";
import { demasiadosIntentos, registrarIntento } from "@/lib/seguridad/limite";
import { activarSesion, cerrarSesion, cerrarSesionesDe, crearSesion, ipDelPedido, sesionActual } from "@/lib/seguridad/sesion";
import { descifrar, verificarTotp } from "@/lib/seguridad/totp";

export type EstadoForm = { error?: string; valores?: Record<string, string> } | undefined;
const txt = (v: unknown) => (typeof v === "string" ? v : "");
const GENERICO = "Usuario o contraseña incorrectos.";
// En produccion los administradores SIEMPRE usan doble verificacion. En desarrollo es opcional (REQUERIR_2FA=1 la exige).
const exige2fa = () => process.env.NODE_ENV === "production" || process.env.REQUERIR_2FA === "1";

export async function iniciarSesion(_: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const email = txt(fd.get("email")).trim().toLowerCase();
  const clave = txt(fd.get("clave"));
  const destino = destinoSeguro(txt(fd.get("next")));
  const ip = await ipDelPedido();
  const conservar = { valores: { email } }; // al fallar se vuelve a mostrar el email (la contrasena nunca)
  if (!email || !clave || email.length > 200 || clave.length > 200) return { error: GENERICO, ...conservar };

  if (await demasiadosIntentos(email, ip)) {
    await verificarClave(clave, await hashDeRelleno()); // mismo tiempo de respuesta
    await auditar("login_bloqueado", { email }, { email, ip }).catch(() => {});
    return { error: "Demasiados intentos fallidos. Esperá 15 minutos e intentá de nuevo.", ...conservar };
  }

  const r = await pool.query<{ id: number; password_hash: string; rol: "admin" | "encargado" | "vendedor" | "deposito"; activo: boolean; totp_activo: boolean; debe: boolean }>(
    "select id::int as id, password_hash, rol, activo, totp_activo, debe_cambiar_clave as debe from usuarios where lower(email) = $1", [email],
  );
  const u = r.rows[0];
  const claveOk = await verificarClave(clave, u?.password_hash ?? (await hashDeRelleno()));
  const ok = !!u && u.activo && claveOk;
  await registrarIntento(email, ip, ok);
  if (!ok) {
    await auditar("login_fallido", { email }, { email, ip }).catch(() => {});
    return { error: GENERICO, ...conservar };
  }

  await cerrarSesion(); // si habia una sesion vieja en este navegador, se descarta (evita reutilizarla)
  const fase = u.totp_activo ? "2fa_pendiente" : u.rol === "admin" && exige2fa() ? "2fa_alta" : "activa";
  await crearSesion(u.id, u.rol, fase);
  if (fase === "activa") await pool.query("update usuarios set ultimo_login = now() where id = $1", [u.id]);
  await auditar(fase === "activa" ? "login_ok" : "login_clave_ok", { fase }, { usuarioId: u.id, email, ip });
  if (fase === "2fa_pendiente") redirect("/login/verificar");
  if (fase === "2fa_alta") redirect("/cuenta/doble-verificacion");
  redirect(u.debe ? "/cuenta/clave" : destino);
}

export async function verificarCodigo(_: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const s = await sesionActual();
  if (!s || s.fase !== "2fa_pendiente") redirect("/login");
  const ip = await ipDelPedido();
  const clave2fa = `totp:${s.usuario.id}`;
  if (await demasiadosIntentos(clave2fa, ip)) {
    await cerrarSesion();
    await auditar("2fa_bloqueado", {}, { usuarioId: s.usuario.id, email: s.usuario.email, ip }).catch(() => {});
    redirect("/login");
  }
  const r = await pool.query<{ secreto: string | null; ultimo: string | null }>("select totp_secreto as secreto, totp_ultimo_paso as ultimo from usuarios where id = $1", [s.usuario.id]);
  const secreto = r.rows[0]?.secreto ? descifrar(r.rows[0].secreto) : null;
  const paso = secreto ? verificarTotp(secreto, txt(fd.get("codigo"))) : null;
  const ultimo = r.rows[0]?.ultimo ? Number(r.rows[0].ultimo) : 0;
  if (paso === null || paso <= ultimo) { // un codigo ya usado no vale otra vez
    await registrarIntento(clave2fa, ip, false);
    await auditar("2fa_fallido", {}, { usuarioId: s.usuario.id, email: s.usuario.email, ip }).catch(() => {});
    return { error: "Código incorrecto. Probá con el que muestra tu aplicación ahora." };
  }
  await registrarIntento(clave2fa, ip, true);
  await pool.query("update usuarios set totp_ultimo_paso = $2, ultimo_login = now() where id = $1", [s.usuario.id, paso]);
  await activarSesion(s.id);
  await auditar("login_ok", { fase: "2fa" }, { usuarioId: s.usuario.id, email: s.usuario.email, ip });
  revalidatePath("/", "layout"); // el menu se calcula de nuevo con la sesion ya completa
  redirect(s.usuario.debeCambiarClave ? "/cuenta/clave" : "/");
}

export async function confirmarDobleVerificacion(_: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const s = await sesionActual();
  if (!s || (s.fase !== "2fa_alta" && s.fase !== "activa")) redirect("/login");
  const r = await pool.query<{ secreto: string | null }>("select totp_secreto as secreto from usuarios where id = $1", [s.usuario.id]);
  const secreto = r.rows[0]?.secreto ? descifrar(r.rows[0].secreto) : null;
  const paso = secreto ? verificarTotp(secreto, txt(fd.get("codigo"))) : null;
  if (paso === null) return { error: "Código incorrecto. Revisá que la hora de tu celular sea la correcta e intentá de nuevo." };
  await pool.query("update usuarios set totp_activo = true, totp_ultimo_paso = $2, ultimo_login = now() where id = $1", [s.usuario.id, paso]);
  if (s.fase === "2fa_alta") await activarSesion(s.id);
  await auditar("2fa_activado", {}, { usuarioId: s.usuario.id, email: s.usuario.email });
  revalidatePath("/", "layout");
  redirect(s.usuario.debeCambiarClave ? "/cuenta/clave" : "/");
}

export async function cambiarClave(_: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const s = await sesionActual();
  if (!s || s.fase !== "activa") redirect("/login");
  const actual = txt(fd.get("actual"));
  const nueva = txt(fd.get("nueva"));
  const ip = await ipDelPedido();
  if (nueva !== txt(fd.get("repetir"))) return { error: "Las dos contraseñas nuevas no coinciden." };
  const r = await pool.query<{ password_hash: string }>("select password_hash from usuarios where id = $1", [s.usuario.id]);
  if (!(await verificarClave(actual, r.rows[0]?.password_hash ?? (await hashDeRelleno())))) {
    await auditar("clave_cambio_fallido", {}, { usuarioId: s.usuario.id, email: s.usuario.email, ip }).catch(() => {});
    return { error: "La contraseña actual no es correcta." };
  }
  const problema = validarClaveNueva(nueva, s.usuario.email);
  if (problema) return { error: problema };
  if (await verificarClave(nueva, r.rows[0].password_hash)) return { error: "La contraseña nueva tiene que ser distinta de la actual." };
  await pool.query("update usuarios set password_hash = $2, debe_cambiar_clave = false, clave_cambiada_en = now() where id = $1", [s.usuario.id, await hashClave(nueva)]);
  await cerrarSesionesDe(s.usuario.id, s.id); // se cierran las demas sesiones de este usuario
  await auditar("clave_cambiada", {}, { usuarioId: s.usuario.id, email: s.usuario.email, ip });
  revalidatePath("/", "layout"); // el menu vuelve a mostrar los accesos del usuario
  redirect("/");
}

export async function cerrarSesionAccion() {
  const s = await sesionActual();
  if (s) await auditar("logout", {}, { usuarioId: s.usuario.id, email: s.usuario.email }).catch(() => {});
  await cerrarSesion();
  redirect("/login");
}

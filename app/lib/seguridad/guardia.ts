import { redirect } from "next/navigation";
import { puede, type Permiso } from "./permisos";
import { sesionActual } from "./sesion";

// Guardia de las pantallas (se usa en el layout de cada seccion). Es la segunda linea de defensa: la primera es proxy.ts
// (rechaza pedidos sin cookie) y la mas importante es la verificacion de cada accion en app/actions.ts.
export async function requerirUsuario() {
  const s = await sesionActual();
  if (!s) redirect("/login");
  if (s.fase === "2fa_pendiente") redirect("/login/verificar");
  if (s.fase === "2fa_alta") redirect("/cuenta/doble-verificacion");
  if (s.usuario.debeCambiarClave) redirect("/cuenta/clave");
  return s.usuario;
}

export async function requerirPermiso(permiso: Permiso) {
  const u = await requerirUsuario();
  if (!puede(u.rol, permiso)) redirect("/sin-permiso");
  return u;
}

// Destino despues de iniciar sesion: solo rutas internas ("/algo"), nunca una direccion externa.
export const destinoSeguro = (next: string | null | undefined) =>
  next && /^\/(?!\/)[\w\-/.?=&%]*$/.test(next) && !next.startsWith("/login") ? next : "/";

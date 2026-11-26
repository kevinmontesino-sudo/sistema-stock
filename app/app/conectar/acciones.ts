"use server";
import { redirect } from "next/navigation";
import { aprobarPedido, ErrorOAuth, leerPedido, rechazarPedido } from "@/lib/oauth";
import { auditar } from "@/lib/seguridad/auditoria";
import { ipDelPedido, usuarioActual } from "@/lib/seguridad/sesion";

// "Permitir" / "Cancelar" de la pantalla /conectar (login del conector de Claude/ChatGPT). Solo administradores con la sesion completa.
const id = (fd: FormData) => String(fd.get("p") ?? "").slice(0, 64);

export async function aprobarConexion(fd: FormData) {
  const u = await usuarioActual();
  const p = id(fd);
  if (!u) redirect(`/login?next=${encodeURIComponent(`/conectar?p=${p}`)}`);
  const pedido = await leerPedido(p);
  let destino: string;
  try {
    destino = await aprobarPedido(p, u);
  } catch (e) {
    const motivo = e instanceof ErrorOAuth ? e.codigo : "error";
    redirect(`/conectar?p=${encodeURIComponent(p)}&e=${motivo}`);
  }
  await auditar("conexion_claude_autorizada", { cliente: pedido?.cliente ?? "?", destino: pedido?.destino ?? "?" }, { usuarioId: u.id, email: u.email, ip: await ipDelPedido() }).catch(() => {});
  redirect(destino);
}

export async function rechazarConexion(fd: FormData) {
  const u = await usuarioActual();
  const destino = await rechazarPedido(id(fd));
  if (u) await auditar("conexion_claude_rechazada", {}, { usuarioId: u.id, email: u.email, ip: await ipDelPedido() }).catch(() => {});
  redirect(destino ?? "/");
}

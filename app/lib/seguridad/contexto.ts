import { AsyncLocalStorage } from "node:async_hooks";
import type { Rol } from "./permisos";

export type UsuarioSesion = {
  id: number; nombre: string; email: string; rol: Rol; sucursalId: string | null;
  totpActivo: boolean; debeCambiarClave: boolean;
};

// Usuario de la accion en curso: asi el resto del codigo (movimientos, auditoria) sabe quien la hizo sin pasarlo a mano.
const almacen = new AsyncLocalStorage<{ usuario: UsuarioSesion; ip: string | null }>();
export const conUsuario = <T>(usuario: UsuarioSesion, ip: string | null, fn: () => Promise<T>) => almacen.run({ usuario, ip }, fn);
export const usuarioEnCurso = () => almacen.getStore()?.usuario ?? null;
export const ipEnCurso = () => almacen.getStore()?.ip ?? null;

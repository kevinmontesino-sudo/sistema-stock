"use client";
import { createContext, useContext } from "react";
import type { Permiso, Rol } from "@/lib/seguridad/permisos";

// Datos de la sesion para la interfaz (menu, sucursal fija). Es solo comodidad: quien decide es siempre el servidor.
export type DatosSesion = { nombre: string; email: string; rol: Rol; sucursalFija: string | null; permisos: Permiso[] };
export const SesionCtx = createContext<DatosSesion | null>(null);
export const useSesion = () => useContext(SesionCtx);
export const usePuede = (p: Permiso) => !!useContext(SesionCtx)?.permisos.includes(p);

// El layout (servidor) no puede usar SesionCtx.Provider directo: este componente de cliente lo envuelve.
export function SesionProvider({ valor, children }: { valor: DatosSesion | null; children: React.ReactNode }) {
  return <SesionCtx.Provider value={valor}>{children}</SesionCtx.Provider>;
}

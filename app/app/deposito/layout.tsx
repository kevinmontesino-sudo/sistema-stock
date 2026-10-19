import { requerirPermiso } from "@/lib/seguridad/guardia";

// Pantalla protegida: sin sesion o sin el permiso "ver_totales" no se muestra.
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requerirPermiso("ver_totales");
  return children;
}

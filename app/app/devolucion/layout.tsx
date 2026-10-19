import { requerirPermiso } from "@/lib/seguridad/guardia";

// Pantalla protegida: sin sesion o sin el permiso "devolver" no se muestra.
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requerirPermiso("devolver");
  return children;
}

import { requerirPermiso } from "@/lib/seguridad/guardia";

// Todo lo de /admin es solo para administradores.
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requerirPermiso("admin");
  return children;
}

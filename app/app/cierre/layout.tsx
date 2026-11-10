import { requerirPermiso } from "@/lib/seguridad/guardia";

// Cierre de caja: lo puede hacer cualquier cuenta que vende (cada local cierra el suyo).
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requerirPermiso("vender");
  return children;
}

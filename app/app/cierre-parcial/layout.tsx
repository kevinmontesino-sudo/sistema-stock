import { requerirPermiso } from "@/lib/seguridad/guardia";

// Cierre parcial: lo puede hacer cualquier cuenta que vende (cada local hace los suyos).
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requerirPermiso("vender");
  return children;
}

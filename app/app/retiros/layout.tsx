import { requerirPermiso } from "@/lib/seguridad/guardia";

// Retiro de efectivo: lo puede anotar cualquier cuenta que vende (cada local anota los suyos).
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requerirPermiso("vender");
  return children;
}

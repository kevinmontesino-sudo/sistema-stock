import { requerirUsuario } from "@/lib/seguridad/guardia";

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requerirUsuario();
  return children;
}

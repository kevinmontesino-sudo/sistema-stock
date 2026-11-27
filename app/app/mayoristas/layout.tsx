import { requerirPermiso } from "@/lib/seguridad/guardia";

// Clientes mayoristas del Deposito (venta a cuenta): solo el Deposito y los administradores. Los locales no lo ven.
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requerirPermiso("cuentas_mayoristas");
  return children;
}

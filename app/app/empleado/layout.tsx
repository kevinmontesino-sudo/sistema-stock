import { requerirPermiso } from "@/lib/seguridad/guardia";

// Compra de empleado: las prendas que se lleva un empleado bajan del stock y se cargan a su cuenta corriente en la ficha.
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requerirPermiso("compra_empleado");
  return children;
}

import { redirect } from "next/navigation";

// El retiro de efectivo ahora es la "Salida de caja fuerte" y vive junto a "Guardar en caja fuerte".
export default function Retiros() {
  redirect("/cierre-parcial");
}

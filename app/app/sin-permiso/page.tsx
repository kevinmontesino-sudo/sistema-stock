import Link from "next/link";
import { requerirUsuario } from "@/lib/seguridad/guardia";

export default async function SinPermiso() {
  await requerirUsuario();
  return (
    <div className="tarjeta" style={{ maxWidth: 480, margin: "40px auto" }}>
      <h1 style={{ marginTop: 0 }}>No tenés permiso</h1>
      <p>Tu usuario no puede entrar a esa pantalla. Si lo necesitás, pedíselo a un administrador.</p>
      <Link href="/" className="boton-link">Volver al inicio</Link>
    </div>
  );
}

import { redirect } from "next/navigation";
import { FormularioAcceso } from "@/components/FormularioAcceso";
import { Logo } from "@/components/Logo";
import { destinoSeguro } from "@/lib/seguridad/guardia";
import { sesionActual } from "@/lib/seguridad/sesion";
import { iniciarSesion } from "./acciones";

export const metadata = { title: "Ingresar · Sistema de stock" };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const s = await sesionActual();
  if (s?.fase === "activa") redirect("/");
  const { next } = await searchParams;
  return (
    <div style={{ maxWidth: 380, margin: "40px auto" }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}><Logo alto={70} /></div>
      <div className="tarjeta">
        <h1 style={{ marginTop: 0 }}>Ingresar</h1>
        <FormularioAcceso accion={iniciarSesion} boton="Ingresar" oculto={{ next: destinoSeguro(next) }} campos={[
          { name: "email", etiqueta: "Email", type: "email", autoComplete: "username", autoFocus: true },
          { name: "clave", etiqueta: "Contraseña", type: "password", autoComplete: "current-password" },
        ]} />
      </div>
      <p className="aviso" style={{ textAlign: "center" }}>Solo para el personal. Si no tenés usuario, pedíselo a un administrador.</p>
    </div>
  );
}

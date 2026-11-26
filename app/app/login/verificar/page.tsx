import { redirect } from "next/navigation";
import { FormularioAcceso } from "@/components/FormularioAcceso";
import { destinoSeguro } from "@/lib/seguridad/guardia";
import { sesionActual } from "@/lib/seguridad/sesion";
import { verificarCodigo } from "../acciones";

export default async function Verificar({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const s = await sesionActual();
  if (!s) redirect("/login");
  if (s.fase !== "2fa_pendiente") redirect("/");
  return (
    <div style={{ maxWidth: 380, margin: "40px auto" }}>
      <div className="tarjeta">
        <h1 style={{ marginTop: 0 }}>Código de verificación</h1>
        <p className="aviso">Abrí tu aplicación de autenticación (Google Authenticator, Microsoft Authenticator, Authy…) y escribí el código de 6 dígitos.</p>
        <FormularioAcceso accion={verificarCodigo} boton="Verificar" oculto={{ next: destinoSeguro(next) }} campos={[
          { name: "codigo", etiqueta: "Código", inputMode: "numeric", autoComplete: "one-time-code", maxLength: 8, autoFocus: true },
        ]} />
      </div>
    </div>
  );
}

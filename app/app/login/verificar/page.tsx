import { redirect } from "next/navigation";
import { FormularioAcceso } from "@/components/FormularioAcceso";
import { sesionActual } from "@/lib/seguridad/sesion";
import { verificarCodigo } from "../acciones";

export default async function Verificar() {
  const s = await sesionActual();
  if (!s) redirect("/login");
  if (s.fase !== "2fa_pendiente") redirect("/");
  return (
    <div style={{ maxWidth: 380, margin: "40px auto" }}>
      <div className="tarjeta">
        <h1 style={{ marginTop: 0 }}>Código de verificación</h1>
        <p className="aviso">Abrí tu aplicación de autenticación (Google Authenticator, Microsoft Authenticator, Authy…) y escribí el código de 6 dígitos.</p>
        <FormularioAcceso accion={verificarCodigo} boton="Verificar" campos={[
          { name: "codigo", etiqueta: "Código", inputMode: "numeric", autoComplete: "one-time-code", maxLength: 8, autoFocus: true },
        ]} />
      </div>
    </div>
  );
}

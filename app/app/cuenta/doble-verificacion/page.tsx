import { redirect } from "next/navigation";
import { CodigoQr } from "@/components/CodigoQr";
import { FormularioAcceso } from "@/components/FormularioAcceso";
import { empresa } from "@/lib/empresa.config";
import { sesionActual } from "@/lib/seguridad/sesion";
import { urlOtp } from "@/lib/seguridad/totp";
import { confirmarDobleVerificacion, secretoParaAlta } from "@/app/login/acciones";

export default async function DobleVerificacion() {
  const s = await sesionActual();
  if (!s || (s.fase !== "2fa_alta" && s.fase !== "activa")) redirect("/login");
  if (s.usuario.totpActivo) {
    return (
      <div style={{ maxWidth: 420, margin: "40px auto" }}>
        <div className="tarjeta"><h1 style={{ marginTop: 0 }}>Doble verificación</h1>
          <p>Ya está activada en tu usuario. Si perdiste el celular, otro administrador puede reiniciarla desde Usuarios.</p></div>
      </div>
    );
  }
  const secreto = await secretoParaAlta(s.usuario.id);
  return (
    <div style={{ maxWidth: 460, margin: "40px auto" }}>
      <div className="tarjeta">
        <h1 style={{ marginTop: 0 }}>Activar la doble verificación</h1>
        <p className="aviso">Protege tu cuenta aunque alguien conozca tu contraseña. Es obligatoria para los administradores.</p>
        <ol style={{ paddingLeft: 18 }}>
          <li>Instalá en tu celular una aplicación de autenticación (Google Authenticator, Microsoft Authenticator, Authy…).</li>
          <li>Escaneá este código QR con la aplicación:</li>
        </ol>
        <CodigoQr valor={urlOtp(secreto, s.usuario.email, empresa.nombre)} />
        <p className="aviso">Si no podés escanearlo, cargá este código a mano: <code style={{ wordBreak: "break-all" }}>{secreto}</code></p>
        <p>3. Escribí el código de 6 dígitos que te muestra la aplicación:</p>
        <FormularioAcceso accion={confirmarDobleVerificacion} boton="Activar" campos={[
          { name: "codigo", etiqueta: "Código", inputMode: "numeric", autoComplete: "one-time-code", maxLength: 8, autoFocus: true },
        ]} />
      </div>
    </div>
  );
}

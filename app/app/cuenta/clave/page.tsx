import { FormularioAcceso } from "@/components/FormularioAcceso";
import { sesionActual } from "@/lib/seguridad/sesion";
import { redirect } from "next/navigation";
import { cambiarClave } from "@/app/login/acciones";

export default async function Clave() {
  const s = await sesionActual();
  if (!s || s.fase !== "activa") redirect("/login");
  return (
    <div style={{ maxWidth: 420, margin: "40px auto" }}>
      <div className="tarjeta">
        <h1 style={{ marginTop: 0 }}>{s.usuario.debeCambiarClave ? "Elegí tu contraseña" : "Cambiar contraseña"}</h1>
        {s.usuario.debeCambiarClave && <p className="alerta">Estás usando una contraseña temporal: tenés que cambiarla para seguir.</p>}
        <p className="aviso">Mínimo 10 caracteres, con al menos 3 tipos: minúsculas, mayúsculas, números y símbolos. No uses tu email ni algo fácil de adivinar.</p>
        <FormularioAcceso accion={cambiarClave} boton="Guardar contraseña" campos={[
          { name: "actual", etiqueta: "Contraseña actual", type: "password", autoComplete: "current-password" },
          { name: "nueva", etiqueta: "Contraseña nueva", type: "password", autoComplete: "new-password", autoFocus: true },
          { name: "repetir", etiqueta: "Repetir la contraseña nueva", type: "password", autoComplete: "new-password" },
        ]} />
      </div>
    </div>
  );
}

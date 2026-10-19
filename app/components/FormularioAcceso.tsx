"use client";
import { useActionState } from "react";
import type { EstadoForm } from "@/app/login/acciones";

type Campo = { name: string; etiqueta: string; type?: string; autoComplete?: string; inputMode?: "numeric" | "text"; maxLength?: number; autoFocus?: boolean };

// Formulario de las pantallas de acceso (login, codigo de doble verificacion, cambio de clave): muestra el error del servidor.
export function FormularioAcceso({ accion, campos, boton, oculto }: {
  accion: (e: EstadoForm, f: FormData) => Promise<EstadoForm>;
  campos: Campo[]; boton: string; oculto?: Record<string, string>;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, undefined);
  return (
    <form action={enviar} style={{ display: "grid", gap: 12 }}>
      {Object.entries(oculto ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {campos.map((c) => (
        <label key={c.name} style={{ display: "grid", gap: 4 }}>
          <span>{c.etiqueta}</span>
          <input key={`${c.name}-${estado?.error ?? ""}`} name={c.name} type={c.type ?? "text"} defaultValue={estado?.valores?.[c.name] ?? ""} required autoComplete={c.autoComplete ?? "off"} inputMode={c.inputMode}
            maxLength={c.maxLength ?? 200} autoFocus={c.autoFocus} />
        </label>
      ))}
      <p className="error" role="alert" style={{ margin: 0, minHeight: "1.2em" }}>{estado?.error}</p>
      <button className="principal" type="submit" disabled={pendiente}>{pendiente ? "Verificando…" : boton}</button>
    </form>
  );
}

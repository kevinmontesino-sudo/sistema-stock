"use client";
import { useEffect } from "react";

// Si una pantalla falla (casi siempre: se corto la conexion con la base), se muestra esto en vez del error tecnico.
// No se muestra el detalle del error: puede tener datos internos. Queda en la consola del servidor.
export default function ErrorDePantalla({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="tarjeta" style={{ maxWidth: 520, margin: "40px auto", textAlign: "center" }}>
      <h1>No se pudo cargar esta pantalla</h1>
      <p className="aviso">Puede ser un corte de internet. Esperá unos segundos y probá de nuevo; lo que ya estaba guardado no se pierde.</p>
      <button className="principal" onClick={() => retry()}>Probar de nuevo</button>
    </div>
  );
}

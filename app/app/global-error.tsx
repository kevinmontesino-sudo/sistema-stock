"use client";
import { useEffect } from "react";

// Igual que error.tsx pero para cuando falla la estructura general (cabecera, sesion). Reemplaza el layout,
// por eso lleva su propio <html> y estilos minimos.
export default function ErrorGeneral({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <html lang="es">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "Canvas", color: "CanvasText", margin: 0, padding: 16 }}>
        <title>Sin conexión · Sistema de stock</title>
        <div style={{ maxWidth: 520, margin: "60px auto", textAlign: "center" }}>
          <h1 style={{ fontSize: 22 }}>No hay conexión con el sistema</h1>
          <p>Puede ser un corte de internet. Esperá unos segundos y probá de nuevo; lo que ya estaba guardado no se pierde.</p>
          <button onClick={() => retry()} style={{ font: "inherit", fontWeight: 600, padding: "10px 18px", borderRadius: 8, border: 0, background: "#1f5fbf", color: "#fff", cursor: "pointer" }}>Probar de nuevo</button>
        </div>
      </body>
    </html>
  );
}

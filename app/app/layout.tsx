import type { Metadata } from "next";
import { Cabecera } from "@/components/Cabecera";
import { SesionProvider } from "@/components/SesionContext";
import { empresa } from "@/lib/empresa.config";
import { permisosDe, origenesStock, sucursalFija } from "@/lib/seguridad/permisos";
import { usuarioActual } from "@/lib/seguridad/sesion";
import "./globals.css";

// Copia de pruebas (staging): se compila con NEXT_PUBLIC_ENTORNO=pruebas (npm run staging). En produccion no esta y no se ve nada.
const PRUEBAS = process.env.NEXT_PUBLIC_ENTORNO === "pruebas";

export const metadata: Metadata = {
  title: "Sistema de stock",
  description: "Control de mercadería y movimientos entre sucursales",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const u = await usuarioActual();
  const sesion = u && { nombre: u.nombre, email: u.email, rol: u.rol, sucursalFija: sucursalFija(u.rol, u.sucursalId), origenStock: origenesStock(u.rol, u.sucursalId), // Con contrasena temporal no se muestra ningun acceso: solo se puede elegir la nueva.
    permisos: u.debeCambiarClave ? [] : permisosDe(u.rol) };
  return (
    <html
      lang="es"
      style={{
        "--etq-w": `${empresa.etiquetaMm.ancho}mm`,
        "--etq-h": `${empresa.etiquetaMm.alto}mm`,
        "--ticket-w": `${empresa.ticketMm.ancho}mm`,
      } as React.CSSProperties}
    >
      <body>
        {PRUEBAS && (
          <div role="alert" className="no-print" style={{ background: "#c62828", color: "#fff", textAlign: "center", fontWeight: 700, padding: "6px 12px", letterSpacing: "0.03em" }}>
            COPIA DE PRUEBAS — no es el sistema real. Lo que hagas acá no cuenta.
          </div>
        )}
        <SesionProvider valor={sesion}>
          <Cabecera />
          <main>{children}</main>
        </SesionProvider>
      </body>
    </html>
  );
}

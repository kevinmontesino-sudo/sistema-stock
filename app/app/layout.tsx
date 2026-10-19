import type { Metadata } from "next";
import { Cabecera } from "@/components/Cabecera";
import { SesionProvider } from "@/components/SesionContext";
import { empresa } from "@/lib/empresa.config";
import { permisosDe, sucursalFija } from "@/lib/seguridad/permisos";
import { usuarioActual } from "@/lib/seguridad/sesion";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sistema de stock",
  description: "Control de mercadería y movimientos entre sucursales",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const u = await usuarioActual();
  const sesion = u && { nombre: u.nombre, email: u.email, rol: u.rol, sucursalFija: sucursalFija(u.rol, u.sucursalId), // Con contrasena temporal no se muestra ningun acceso: solo se puede elegir la nueva.
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
        <SesionProvider valor={sesion}>
          <Cabecera />
          <main>{children}</main>
        </SesionProvider>
      </body>
    </html>
  );
}

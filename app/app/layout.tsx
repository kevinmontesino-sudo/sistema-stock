import type { Metadata } from "next";
import { Cabecera } from "@/components/Cabecera";
import { empresa } from "@/lib/empresa.config";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sistema de stock",
  description: "Control de mercadería y movimientos entre sucursales",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
        <Cabecera />
        <main>{children}</main>
      </body>
    </html>
  );
}

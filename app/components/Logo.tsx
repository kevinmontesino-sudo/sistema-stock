 
import { empresa } from "@/lib/empresa.config";

// Logo para pantalla: en modo oscuro la version de colores, en modo claro la version en negro (el blanco del logo no se veria).
export function Logo({ alto = 30, className }: { alto?: number; className?: string }) {
  return (
    <picture>
      <source media="(prefers-color-scheme: dark)" srcSet="/logo.png" />
      <img src="/logo-negro.png" alt={empresa.nombre} className={className} style={{ height: alto, width: "auto", display: "block" }} />
    </picture>
  );
}

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { pendientesDe } from "@/app/actions";
import { empresa } from "@/lib/empresa.config";
import { useSucursal } from "@/lib/hooks";

const links = [
  { href: "/carga", texto: "Carga" },
  { href: "/deposito", texto: "Depósito" },
  { href: "/mover", texto: "Mover" },
  { href: "/ingreso", texto: "Ingreso" },
  { href: "/venta", texto: "Venta" },
  { href: "/buscar", texto: "Buscar" },
];

export function Cabecera() {
  const pathname = usePathname();
  const [sucursal, setSucursal] = useSucursal();
  const [pendientes, setPendientes] = useState(0);

  // Aviso: unidades que le enviaron a esta sucursal y todavia no recibio.
  useEffect(() => {
    let vivo = true;
    const cargar = () => pendientesDe(sucursal).then((r) => vivo && r.ok && setPendientes(r.pendientes.unidades));
    cargar();
    const t = setInterval(cargar, 30000);
    return () => { vivo = false; clearInterval(t); };
  }, [sucursal, pathname]);
  return (
    <header className="cabecera no-print">
      <Link href="/" className="marca">{empresa.nombre}</Link>
      <nav>
        {links.map((l) => (
          <Link key={l.href} href={l.href} className={pathname === l.href ? "activo" : ""}>
            {l.texto}
            {l.href === "/ingreso" && pendientes > 0 && <span className="insignia" title="Envíos pendientes de recibir">{pendientes}</span>}
          </Link>
        ))}
      </nav>
      <label className="sucursal">
        Sucursal
        <select value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
          {empresa.sucursales.map((s) => (
            <option key={s.id} value={s.id}>{s.nombre}</option>
          ))}
        </select>
      </label>
    </header>
  );
}

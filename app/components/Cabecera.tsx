"use client";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { pendientesDe } from "@/app/actions";
import { cerrarSesionAccion } from "@/app/login/acciones";
import { useSesion } from "@/components/SesionContext";
import { empresa } from "@/lib/empresa.config";
import { useSucursal } from "@/lib/hooks";
import { NOMBRE_ROL, type Permiso } from "@/lib/seguridad/permisos";
import { nombreSucursal } from "@/lib/util";

const links: { href: string; texto: string; permiso: Permiso }[] = [
  { href: "/carga", texto: "Carga", permiso: "cargar" },
  { href: "/deposito", texto: "Depósito", permiso: "ver_totales" },
  { href: "/mover", texto: "Mover", permiso: "mover" },
  { href: "/ingreso", texto: "Ingreso", permiso: "recibir" },
  { href: "/venta", texto: "Venta", permiso: "vender" },
  { href: "/devolucion", texto: "Devolución", permiso: "devolver" },
  { href: "/buscar", texto: "Buscar", permiso: "catalogo" },
  { href: "/admin/usuarios", texto: "Usuarios", permiso: "admin" },
  { href: "/admin/auditoria", texto: "Auditoría", permiso: "admin" },
];

export function Cabecera() {
  const pathname = usePathname();
  const router = useRouter();
  const sesion = useSesion();
  const [sucursal, setSucursal] = useSucursal();
  const [pendientes, setPendientes] = useState(0);

  // Aviso: unidades que le enviaron a esta sucursal y todavia no recibio. Si la sesion vencio, vuelve al login.
  const recibe = !!sesion?.permisos.includes("recibir");
  useEffect(() => {
    if (!recibe) return;
    let vivo = true;
    const cargar = () => pendientesDe(sucursal).then((r) => {
      if (!vivo) return;
      if (r.ok) setPendientes(r.pendientes.unidades);
      else if (r.sesion === false) router.replace("/login");
    });
    cargar();
    const t = setInterval(cargar, 30000);
    return () => { vivo = false; clearInterval(t); };
  }, [sucursal, pathname, router, recibe]);

  if (!sesion) return null;
  return (
    <header className="cabecera no-print">
      <Link href="/" className="marca" aria-label={empresa.nombre}><Logo alto={30} /></Link>
      <nav>
        {links.filter((l) => sesion.permisos.includes(l.permiso)).map((l) => (
          <Link key={l.href} href={l.href} className={pathname === l.href ? "activo" : ""}>
            {l.texto}
            {l.href === "/ingreso" && pendientes > 0 && <span className="insignia" title="Envíos pendientes de recibir">{pendientes}</span>}
          </Link>
        ))}
      </nav>
      {sesion.sucursalFija ? (
        <span className="sucursal">Sucursal <strong>{nombreSucursal(sesion.sucursalFija)}</strong></span>
      ) : (
        <label className="sucursal">
          Sucursal
          <select value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
            {empresa.sucursales.map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </label>
      )}
      <span className="sucursal" title={`${sesion.email} · ${NOMBRE_ROL[sesion.rol]}`}>
        <Link href="/cuenta/clave" style={{ color: "inherit" }}>{sesion.nombre}</Link>
        <form action={cerrarSesionAccion} style={{ display: "inline" }}>
          <button className="chico" type="submit" style={{ marginLeft: 8 }}>Salir</button>
        </form>
      </span>
    </header>
  );
}

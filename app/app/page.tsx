import Link from "next/link";
import { Logo } from "@/components/Logo";
import { requerirUsuario } from "@/lib/seguridad/guardia";
import { puede, type Permiso } from "@/lib/seguridad/permisos";

const accesos: { href: string; texto: string; permiso: Permiso }[] = [
  { href: "/carga", texto: "Carga (depósito)", permiso: "cargar" },
  { href: "/deposito", texto: "Depósito: lo guardado", permiso: "ver_totales" },
  { href: "/mover", texto: "Mover stock entre sucursales", permiso: "mover" },
  { href: "/ingreso", texto: "Ingreso (local)", permiso: "recibir" },
  { href: "/venta", texto: "Venta", permiso: "vender" },
  { href: "/devolucion", texto: "Devolución", permiso: "devolver" },
  { href: "/buscar", texto: "Buscar producto", permiso: "catalogo" },
  { href: "/admin/usuarios", texto: "Usuarios", permiso: "admin" },
  { href: "/admin/informes", texto: "Informes", permiso: "admin" },
  { href: "/admin/auditoria", texto: "Auditoría", permiso: "admin" },
  { href: "/admin/accesos", texto: "Accesos API (llaves)", permiso: "admin" },
];

export default async function Inicio() {
  const u = await requerirUsuario();
  return (
    <>
      <div style={{ margin: "8px 0 16px" }}><Logo alto={90} /></div>
      <h1>¿Qué querés hacer?</h1>
      <div className="home">
        {accesos.filter((a) => puede(u.rol, a.permiso)).map((a) => <Link key={a.href} href={a.href}>{a.texto}</Link>)}
      </div>
    </>
  );
}

"use client";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { avisosEnvios } from "@/app/actions";
import { cerrarSesionAccion } from "@/app/login/acciones";
import { useSesion } from "@/components/SesionContext";
import { empresa } from "@/lib/empresa.config";
import { useAvanzado, useSucursal } from "@/lib/hooks";
import { menuDe, momentoDe } from "@/lib/menu";
import { NOMBRE_ROL } from "@/lib/seguridad/permisos";
import type { AvisoEnvio } from "@/lib/repo";
import { nombreSucursal } from "@/lib/util";

type Avisos = { entrantes: AvisoEnvio[]; salientes: AvisoEnvio[] };

export function Cabecera() {
  const pathname = usePathname();
  const router = useRouter();
  const sesion = useSesion();
  const [sucursal, setSucursal] = useSucursal();
  const [avanzado, setAvanzado] = useAvanzado();
  const [avisos, setAvisos] = useState<Avisos>({ entrantes: [], salientes: [] });
  // El menu del usuario se cierra al tocar afuera o al cambiar de pantalla.
  const menuUsuario = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    menuUsuario.current?.removeAttribute("open");
    const fuera = (e: MouseEvent) => {
      if (menuUsuario.current && !menuUsuario.current.contains(e.target as Node)) menuUsuario.current.removeAttribute("open");
    };
    document.addEventListener("click", fuera);
    return () => document.removeEventListener("click", fuera);
  }, [pathname]);

  // Envios pendientes de esta sucursal (para recibir y sin confirmar). Si la sesion vencio, vuelve al login.
  const recibe = !!sesion?.permisos.includes("recibir");
  useEffect(() => {
    if (!recibe) return;
    let vivo = true;
    const cargar = () => avisosEnvios(sucursal).then((r) => {
      if (!vivo) return;
      if (r.ok) setAvisos(r.avisos);
      else if (r.sesion === false) router.replace("/login");
    }).catch(() => {}); // sin conexion: se reintenta en la proxima vuelta
    cargar();
    const t = setInterval(cargar, 30000);
    return () => { vivo = false; clearInterval(t); };
  }, [sucursal, pathname, router, recibe]);

  if (!sesion) return null;
  const menu = menuDe(sesion.rol, sesion.permisos);
  const actual = momentoDe(pathname, menu);
  const pestanas = menu.find((m) => m.id === actual)?.items ?? [];
  const suc = empresa.sucursales.find((s) => s.id === sucursal) ?? empresa.sucursales[0];
  const porRecibir = avisos.entrantes.reduce((t, a) => t + a.unidades, 0);

  return (
    <div className="no-print">
      <header className="cabecera">
        <Link href="/" className="marca" aria-label={empresa.nombre}><Logo alto={30} /></Link>
        <nav className="momentos">
          {menu.map((m) => (
            <Link key={m.id} href={m.items[0].href} className={actual === m.id ? "activo" : ""}>
              <span aria-hidden>{m.icono}</span> {m.titulo}
              {m.id === "distribuir" && porRecibir > 0 && <span className="insignia" title="Prendas para recibir">{porRecibir}</span>}
            </Link>
          ))}
        </nav>
        <details className="usuario" ref={menuUsuario}>
          <summary title={`${sesion.email} · ${NOMBRE_ROL[sesion.rol]}`}>{sesion.nombre}</summary>
          <div className="menu-usuario">
            <span className="rotulo">{sesion.email}<br />{NOMBRE_ROL[sesion.rol]}</span>
            <label className="fila" style={{ gap: 8 }}>
              <input type="checkbox" checked={avanzado} onChange={(e) => setAvanzado(e.target.checked)} />
              Opciones avanzadas
            </label>
            <span className="rotulo">Muestra ajustes extra (por ejemplo, armar envíos a mano). Apagado es más simple.</span>
            <Link href="/cuenta/clave">Cambiar contraseña</Link>
            <form action={cerrarSesionAccion}><button className="chico" type="submit">Salir</button></form>
          </div>
        </details>
      </header>

      <div className="franja-sucursal" style={{ background: suc.color }}>
        {sesion.sucursalFija ? (
          <span>Estás en <strong>{nombreSucursal(sesion.sucursalFija).toUpperCase()}</strong></span>
        ) : (
          <label>
            Trabajando en{" "}
            <select value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
              {empresa.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </label>
        )}
      </div>

      {pestanas.length > 1 && (
        <nav className="pestanas">
          {pestanas.map((i) => (
            <Link key={i.href} href={i.href} className={pathname === i.href ? "activo" : ""}>
              {i.texto}
              {i.href === "/ingreso" && porRecibir > 0 && <span className="insignia">{porRecibir}</span>}
            </Link>
          ))}
        </nav>
      )}

      <AvisosEnvios avisos={avisos} enRecibir={pathname === "/ingreso"} verEnvios={sesion.permisos.includes("cancelar_envio")} />
    </div>
  );
}

const horasDesde = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
const hace = (h: number) => (h < 1 ? "hace un rato" : h < 48 ? `hace ${h} h` : `hace ${Math.floor(h / 24)} días`);
const prendas = (n: number) => `${n} ${n === 1 ? "prenda" : "prendas"}`;

function AvisosEnvios({ avisos, enRecibir, verEnvios }: { avisos: Avisos; enRecibir: boolean; verEnvios: boolean }) {
  const limite = empresa.avisoSinRecibirHoras;
  // Lo que mando esta sucursal solo se avisa si ya paso el limite: antes es normal que este en camino.
  const atrasados = avisos.salientes.filter((a) => horasDesde(a.desde) >= limite);
  if (avisos.entrantes.length === 0 && atrasados.length === 0) return null;
  return (
    <div className="avisos">
      {!enRecibir && avisos.entrantes.map((a) => {
        const h = horasDesde(a.desde);
        return (
          <div key={"e" + a.sucursal} className={`aviso-envio ${h >= limite ? "atrasado" : ""}`}>
            <span>📦 Te mandaron <strong>{prendas(a.unidades)}</strong> desde {nombreSucursal(a.sucursal)} · {hace(h)}</span>
            <Link href="/ingreso" className="boton">Recibir ahora</Link>
          </div>
        );
      })}
      {atrasados.map((a) => (
        <div key={"s" + a.sucursal} className="aviso-envio atrasado">
          <span>⏳ {nombreSucursal(a.sucursal)} todavía no confirmó <strong>{prendas(a.unidades)}</strong> que le mandaste {hace(horasDesde(a.desde))}</span>
          {verEnvios && <Link href="/deposito" className="boton">Ver envíos</Link>}
        </div>
      ))}
    </div>
  );
}

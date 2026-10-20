import Link from "next/link";
import { Logo } from "@/components/Logo";
import { menuDe } from "@/lib/menu";
import { requerirUsuario } from "@/lib/seguridad/guardia";

// Inicio segun la cuenta: primero lo que mas usa (un local, vender; el deposito, cargar). Los avisos de envios
// pendientes aparecen arriba, en la cabecera, en todas las pantallas.
export default async function Inicio() {
  const u = await requerirUsuario();
  const menu = menuDe(u.rol);
  return (
    <>
      <div style={{ margin: "8px 0 16px" }}><Logo alto={70} /></div>
      {menu.map((m, i) => (
        <section key={m.id} className={`bloque-momento ${i === 0 ? "principal" : ""}`}>
          <h2><span aria-hidden>{m.icono}</span> {m.titulo}</h2>
          <div className="home">
            {m.items.map((it) => (
              <Link key={it.href} href={it.href}>{it.texto}<small>{it.ayuda}</small></Link>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

import { redirect } from "next/navigation";
import { leerPedido } from "@/lib/oauth";
import { sesionActual } from "@/lib/seguridad/sesion";
import { aprobarConexion, rechazarConexion } from "./acciones";

// Pantalla de autorizacion del conector (OAuth): Claude o ChatGPT piden permiso para usar el sistema en nombre de quien inicia sesion.
// Pide la sesion completa (con el codigo de seguridad de los admin) y solo deja conectar a administradores.
export default async function Conectar({ searchParams }: { searchParams: Promise<{ p?: string; e?: string }> }) {
  const { p = "", e } = await searchParams;
  const volver = `/conectar?p=${encodeURIComponent(p)}`;
  const s = await sesionActual();
  if (!s) redirect(`/login?next=${encodeURIComponent(volver)}`);
  if (s.fase === "2fa_pendiente") redirect(`/login/verificar?next=${encodeURIComponent(volver)}`);
  if (s.fase === "2fa_alta") redirect("/cuenta/doble-verificacion");
  if (s.usuario.debeCambiarClave) redirect("/cuenta/clave");
  const pedido = await leerPedido(p);

  return (
    <div style={{ maxWidth: 480, margin: "32px auto" }}>
      <div className="tarjeta" style={{ display: "grid", gap: 12 }}>
        {!pedido ? (
          <>
            <h1 style={{ margin: 0 }}>El pedido venció</h1>
            <p className="aviso">{e === "access_denied" ? "Solo un administrador puede conectar el sistema." : "Pasaron más de 10 minutos o ya se usó. Volvé a Claude (o ChatGPT) y tocá «Conectar» de nuevo."}</p>
          </>
        ) : s.usuario.rol !== "admin" ? (
          <>
            <h1 style={{ margin: 0 }}>Solo administradores</h1>
            <p className="aviso">Entraste como <strong>{s.usuario.nombre}</strong>. Para conectar el sistema a {pedido.cliente} hace falta una cuenta de administrador.</p>
            <form action={rechazarConexion}><input type="hidden" name="p" value={p} /><button>Volver</button></form>
          </>
        ) : (
          <>
            <h1 style={{ margin: 0 }}>Conectar con {pedido.cliente}</h1>
            <p style={{ margin: 0 }}><strong>{pedido.cliente}</strong> ({pedido.destino}) quiere usar el sistema de X Menos Más Prendas <strong>a tu nombre ({s.usuario.nombre})</strong>.</p>
            <div className="aviso" style={{ display: "grid", gap: 4 }}>
              <span>✔ Ver informes: ventas, cajas, cierres, caja fuerte, anulaciones, descuentos, comisiones y stock.</span>
              <span>✔ Crear y desactivar promos (te va a pedir confirmación antes).</span>
              <span>✖ No puede mover plata, cerrar cajas, anotar retiros ni vender.</span>
            </div>
            <p className="aviso" style={{ margin: 0 }}>Queda anotado a tu nombre y lo podés cortar cuando quieras en Oficina → Accesos API.</p>
            <div className="fila" style={{ gap: 8 }}>
              <form action={aprobarConexion}><input type="hidden" name="p" value={p} /><button className="principal">Permitir</button></form>
              <form action={rechazarConexion}><input type="hidden" name="p" value={p} /><button>Cancelar</button></form>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

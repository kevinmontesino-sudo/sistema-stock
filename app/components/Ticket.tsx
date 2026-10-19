/* eslint-disable @next/next/no-img-element */
import { empresa } from "@/lib/empresa.config";
import { CodigoBarras } from "@/components/CodigoBarras";
import { codigoVenta, DIAS_DEVOLUCION, nombreSucursal, pesos, type PagoCalculado } from "@/lib/util";

export type DatosTicket = {
  id: number;
  fecha: string;
  sucursal: string;
  subtotal: number;
  ajuste: number;
  total: number;
  pagos: PagoCalculado[];
  items: { sku: string; nombre: string; precio: number; cant: number }[];
  // Solo para mostrar en el ticket (no se guarda): plata en efectivo que entrego el cliente.
  recibido?: number;
};

const signo = (n: number) => (n > 0 ? "+" : n < 0 ? "-" : "");

export function Ticket({ venta }: { venta: DatosTicket }) {
  const f = new Date(venta.fecha);
  const dos = (n: number) => String(n).padStart(2, "0");
  // Formato fijo (no depende del idioma del navegador): evita diferencias entre servidor y pantalla.
  const fecha = `${dos(f.getDate())}/${dos(f.getMonth() + 1)}/${f.getFullYear()} ${dos(f.getHours())}:${dos(f.getMinutes())}`;
  const tope = new Date(f.getTime() + DIAS_DEVOLUCION * 86_400_000);
  const limite = `${dos(tope.getDate())}/${dos(tope.getMonth() + 1)}/${tope.getFullYear()}`;
  const cantidad = venta.items.reduce((s, i) => s + i.cant, 0);
  const unico = venta.pagos.length === 1 ? venta.pagos[0] : null;
  const efectivo = venta.pagos.find((p) => p.medioId === "efectivo");
  return (
    <div className="ticket">
      <img src="/logo-negro.png" alt={empresa.nombre} className="ticket-logo" />
      <div className="centro">{nombreSucursal(venta.sucursal)}</div>
      <div className="centro">Ticket N° {venta.id} · {fecha}</div>
      <hr />
      {venta.items.map((i) => (
        <div key={i.sku} className="linea">
          <span>{i.cant} x {i.nombre}</span>
          <span>{pesos(i.precio * i.cant)}</span>
        </div>
      ))}
      <hr />
      <div className="linea"><span>{cantidad} prendas · subtotal lista</span><span>{pesos(venta.subtotal)}</span></div>
      {venta.ajuste !== 0 && (
        <div className="linea">
          <span>{unico ? `${unico.nombre} (${signo(unico.pct)}${Math.abs(unico.pct)}%)` : "Ajuste por medios de pago"}</span>
          <span>{signo(venta.ajuste)}{pesos(Math.abs(venta.ajuste))}</span>
        </div>
      )}
      <div className="linea"><span className="total-t">TOTAL</span><span className="total-t">{pesos(venta.total)}</span></div>
      <hr />
      {venta.pagos.map((p) => (
        <div key={p.medioId} className="linea"><span>Paga {p.nombre}{p.pct !== 0 ? ` (${signo(p.pct)}${Math.abs(p.pct)}%)` : ""}</span><span>{pesos(p.monto)}</span></div>
      ))}
      {venta.recibido !== undefined && efectivo && (
        <>
          <div className="linea"><span>Efectivo recibido</span><span>{pesos(venta.recibido)}</span></div>
          <div className="linea"><span className="total-t">VUELTO</span><span className="total-t">{pesos(venta.recibido - efectivo.monto)}</span></div>
        </>
      )}
      <hr />
      <CodigoBarras valor={codigoVenta(venta.id)} />
      <div className="centro"><strong>Cambios por {DIAS_DEVOLUCION} días</strong></div>
      <div className="centro">Hasta el {limite} presentando este ticket.</div>
      <div className="centro" style={{ margin: "2mm 0" }}><strong>¡Gracias por tu compra!<br />Te esperamos pronto</strong></div>
      <div className="centro">Ticket interno</div>
      <div className="centro">No válido como factura</div>
    </div>
  );
}

import { empresa } from "@/lib/empresa.config";
import { nombreSucursal, pesos, type PagoCalculado } from "@/lib/util";

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
  const fecha = f.toLocaleDateString("es-AR") + " " + f.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  const cantidad = venta.items.reduce((s, i) => s + i.cant, 0);
  const unico = venta.pagos.length === 1 ? venta.pagos[0] : null;
  const efectivo = venta.pagos.find((p) => p.medioId === "efectivo");
  return (
    <div className="ticket">
      <h3>{empresa.nombre}</h3>
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
        <div key={p.medioId} className="linea"><span>Paga {p.nombre}</span><span>{pesos(p.monto)}</span></div>
      ))}
      {venta.recibido !== undefined && efectivo && (
        <>
          <div className="linea"><span>Efectivo recibido</span><span>{pesos(venta.recibido)}</span></div>
          <div className="linea"><span className="total-t">VUELTO</span><span className="total-t">{pesos(venta.recibido - efectivo.monto)}</span></div>
        </>
      )}
      <hr />
      <div className="centro">Ticket interno</div>
      <div className="centro">No válido como factura</div>
    </div>
  );
}

/* eslint-disable @next/next/no-img-element */
import { empresa } from "@/lib/empresa.config";
import { CodigoBarras } from "@/components/CodigoBarras";
import { lineasTicket } from "@/lib/ticketLineas";
import { CORAZON_SVG, TEXTO_REGALO } from "@/lib/ticketRenglones";
import { DIAS_DEVOLUCION, nombreSucursal, pesos, type PagoCalculado } from "@/lib/util";

export type DatosTicket = {
  codigo: string; // codigo al azar del ticket (no el numero interno)
  fecha: string;
  sucursal: string;
  subtotal: number;
  // Promo o descuento especial: se resta del precio de lista antes del medio de pago.
  promo?: { nombre: string; monto: number };
  // Ajuste del medio de pago (sobre el precio de lista menos la promo).
  ajuste: number;
  total: number;
  pagos: PagoCalculado[];
  items: { sku: string; nombre: string; precio: number; cant: number; sinCambio?: boolean }[];
  // Prendas que la empresa regalo con esta compra (sin cobrar).
  regalos?: { sku: string; nombre: string; cant: number }[];
  // Solo para mostrar en el ticket (no se guarda): plata en efectivo que entrego el cliente.
  recibido?: number;
  // Solo para imprimir (no se guarda): ticket de regalo, sin precios.
  regalo?: boolean;
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
  const { items, recargo, textoPct, promo, ahorro, sinCambio, todoSinCambio } = lineasTicket(venta);
  return (
    <div className="ticket">
      <img src="/logo-negro.png" alt={empresa.nombre} className="ticket-logo" />
      <div className="centro">{nombreSucursal(venta.sucursal)}</div>
      <div className="centro">Ticket {venta.codigo} · {fecha}</div>
      {venta.regalo && (
        <div className="centro" style={{ margin: "2mm 0" }}>
          <svg viewBox="0 0 100 90" width="16mm" height="14.4mm" aria-hidden="true"><path d={CORAZON_SVG} fill="#000" /></svg>
          <div><strong>{TEXTO_REGALO.titulo}</strong></div>
          <div>{TEXTO_REGALO.dedicatoria}</div>
        </div>
      )}
      <hr />
      {items.map((i, k) => (
        <div key={k} className="linea">
          <span>{i.cant} x {i.nombre}{i.sinCambio && !todoSinCambio ? " (SIN CAMBIO)" : ""}</span>
          {!venta.regalo && <span>{pesos(i.monto)}</span>}
        </div>
      ))}
      {venta.regalos?.length ? (
        <>
          <div className="centro"><strong>TE REGALAMOS</strong></div>
          {venta.regalos.map((g, k) => <div key={k} className="linea"><span>{g.cant} x {g.nombre}</span><span>REGALO</span></div>)}
        </>
      ) : null}
      <hr />
      {venta.regalo ? (
        <>
          <div className="linea"><span>{cantidad} {cantidad === 1 ? "prenda" : "prendas"}</span></div>
          <div className="linea"><span className="total-t">{TEXTO_REGALO.importe}</span><span className="total-t">{TEXTO_REGALO.valor}</span></div>
        </>
      ) : (<>
      {recargo ? (
        <div className="linea"><span>{cantidad} prendas</span></div>
      ) : (
        <div className="linea"><span>{cantidad} prendas · subtotal lista</span><span>{pesos(venta.subtotal)}</span></div>
      )}
      {venta.promo && (
        <div className="linea"><span>{venta.promo.nombre}</span><span>-{pesos(promo)}</span></div>
      )}
      {venta.ajuste < 0 && (
        <div className="linea">
          <span>{unico ? `${unico.nombre}${textoPct(unico.pct, unico.medioId)}` : "Descuento por medios de pago"}</span>
          <span>{signo(venta.ajuste)}{pesos(Math.abs(venta.ajuste))}</span>
        </div>
      )}
      <div className="linea"><span className="total-t">TOTAL</span><span className="total-t">{pesos(venta.total)}</span></div>
      {ahorro > 0 && <div className="linea"><span><strong>AHORRASTE</strong></span><span><strong>{pesos(ahorro)}</strong></span></div>}
      <hr />
      {venta.pagos.map((p) => (
        <div key={p.medioId} className="linea"><span>Paga {p.nombre}{textoPct(p.pct, p.medioId)}</span><span>{pesos(p.monto)}</span></div>
      ))}
      {venta.recibido !== undefined && efectivo && (
        <>
          <div className="linea"><span>Efectivo recibido</span><span>{pesos(venta.recibido)}</span></div>
          <div className="linea"><span className="total-t">VUELTO</span><span className="total-t">{pesos(venta.recibido - efectivo.monto)}</span></div>
        </>
      )}
      </>)}
      <hr />
      <CodigoBarras valor={venta.codigo} />
      {todoSinCambio ? (
        <div className="centro"><strong>VENTA SIN CAMBIO</strong></div>
      ) : (
        <>
          <div className="centro"><strong>Cambios por {DIAS_DEVOLUCION} días</strong></div>
          <div className="centro">Hasta el {limite} presentando este ticket.</div>
          {sinCambio && <div className="centro">Las prendas marcadas SIN CAMBIO no tienen cambio.</div>}
        </>
      )}
      {venta.regalo ? (
        <div className="centro" style={{ margin: "2mm 0" }}><strong>{TEXTO_REGALO.despedida}</strong><br />
          <svg viewBox="0 0 100 90" width="6mm" height="5.4mm" aria-hidden="true"><path d={CORAZON_SVG} fill="#000" /></svg></div>
      ) : (
        <div className="centro" style={{ margin: "2mm 0" }}><strong>¡Gracias por tu compra!<br />Te esperamos pronto</strong></div>
      )}
      <div className="centro">Ticket interno</div>
      <div className="centro">No válido como factura</div>
    </div>
  );
}

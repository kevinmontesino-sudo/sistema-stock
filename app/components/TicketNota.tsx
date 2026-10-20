/* eslint-disable @next/next/no-img-element */
import { empresa } from "@/lib/empresa.config";
import { CodigoBarras } from "@/components/CodigoBarras";
import { nombreSucursal, pesos, type NotaCredito } from "@/lib/util";

const dia = (iso: string) => new Date(iso).toLocaleDateString("es-AR");

export function TicketNota({ nota }: { nota: NotaCredito }) {
  return (
    <div className="ticket">
      <img src="/logo-negro.png" alt={empresa.nombre} className="ticket-logo" />
      <div className="centro">{nombreSucursal(nota.sucursal)}</div>
      <div className="centro"><strong>NOTA DE CRÉDITO</strong></div>
      <div className="centro">N° {nota.codigo} · Ticket de compra {nota.ventaCodigo}</div>
      <div className="centro">Emitida: {dia(nota.creada)}</div>
      <hr />
      {nota.items.map((i, k) => (
        <div key={k} className="linea"><span>{i.cantidad} x {i.nombre}</span><span>{pesos(i.monto)}</span></div>
      ))}
      <hr />
      <div className="linea"><span className="total-t">VALOR</span><span className="total-t">{pesos(nota.montoInicial)}</span></div>
      {nota.saldo !== nota.montoInicial && <div className="linea"><span>Saldo disponible</span><span>{pesos(nota.saldo)}</span></div>}
      <div className="centro" style={{ marginTop: 6 }}><strong>Sin vencimiento</strong></div>
      <CodigoBarras valor={nota.codigo} ancho="62mm" />
      <div className="centro">Presentala en la caja: se descuenta del total de tu compra.</div>
      <hr />
      <div className="centro">Documento interno</div>
      <div className="centro">No válido como factura</div>
    </div>
  );
}

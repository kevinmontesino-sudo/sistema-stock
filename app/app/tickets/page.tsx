"use client";
import { Ticket, type DatosTicket } from "@/components/Ticket";
import { TicketNota } from "@/components/TicketNota";
import type { NotaCredito } from "@/lib/util";

// Vista previa con datos de ejemplo (no toca la base): sirve para ver como salen y probar si el lector los escanea.
// Los codigos son de ejemplo (V999999 / N999999); no existen en el sistema.
// Fecha fija: si fuera "la hora de ahora", el servidor y el navegador mostrarian horas distintas.
const ahora = "2026-10-13T12:00:00-03:00";
const ventaEjemplo: DatosTicket = {
  id: 999999, fecha: ahora, sucursal: "zelarrayan", subtotal: 47500, ajuste: -5500, total: 42000,
  items: [
    { sku: "REM000001", nombre: "Remera buenos tiempos", precio: 16000, cant: 2 },
    { sku: "JEA000001", nombre: "Jean wide leg dama", precio: 15500, cant: 1 },
  ],
  pagos: [
    { medioId: "transferencia", nombre: "Transferencia", pct: 0, monto: 20000, valorLista: 20000 },
    { medioId: "efectivo", nombre: "Efectivo", pct: -20, monto: 22000, valorLista: 27500 },
  ],
  recibido: 25000,
};
const notaEjemplo: NotaCredito = {
  codigo: "N999999", ventaId: 999999, sucursal: "zelarrayan", creada: ahora, montoInicial: 12800, saldo: 12800, ajustePct: -20, estado: "vigente",
  items: [{ nombre: "Remera buenos tiempos", cantidad: 1, monto: 12800, falladas: 0 }],
};

export default function TicketsPrueba() {
  return (
    <>
      <h1>Vista previa de tickets</h1>
      <p className="aviso" style={{ marginTop: -8 }}>
        Datos de ejemplo, no se guarda nada. Probá escanear los códigos de barras desde la pantalla: en Venta o en Devolución tendrían que leerse.
        El ticket de venta lleva el código <strong>V999999</strong> y la nota de crédito <strong>N999999</strong> (no existen en el sistema).
      </p>
      <div className="fila" style={{ alignItems: "flex-start", gap: 24, flexWrap: "wrap" }}>
        <div><p className="rotulo">Ticket de venta</p><div style={{ boxShadow: "0 0 0 1px var(--borde)" }}><Ticket venta={ventaEjemplo} /></div></div>
        <div><p className="rotulo">Nota de crédito</p><div style={{ boxShadow: "0 0 0 1px var(--borde)" }}><TicketNota nota={notaEjemplo} /></div></div>
      </div>
    </>
  );
}

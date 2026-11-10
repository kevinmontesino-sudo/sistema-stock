"use client";
import { useEffect, useState } from "react";
import { Ticket, type DatosTicket } from "@/components/Ticket";
import { TicketNota } from "@/components/TicketNota";
import { empresa } from "@/lib/empresa.config";
import { ticketNotaEscpos, ticketVentaEscpos } from "@/lib/escpos";
import { imprimirTicketPreferido } from "@/lib/imprimirTicket";
import type { NotaCredito } from "@/lib/util";

// Vista previa con datos de ejemplo (no toca la base): sirve para ver como salen y probar si el lector los escanea.
// Los codigos son de ejemplo (V999999 / N999999); no existen en el sistema.
// Fecha fija: si fuera "la hora de ahora", el servidor y el navegador mostrarian horas distintas.
const ahora = "2026-10-13T12:00:00-03:00";
const ventaEjemplo: DatosTicket = {
  codigo: "V9F3A2C7B", fecha: ahora, sucursal: "zelarrayan", subtotal: 58700, ajuste: -13610, total: 45090,
  items: [
    { sku: "REM000001", nombre: "Remera buenos tiempos", precio: 19900, cant: 2 },
    { sku: "JEA000001", nombre: "Jean wide leg dama", precio: 18900, cant: 1 },
  ],
  pagos: [
    { medioId: "transferencia", nombre: "Transferencia", pct: -10, monto: 18000, valorLista: 20000 },
    { medioId: "efectivo", nombre: "Efectivo", pct: -30, monto: 27090, valorLista: 38700 },
  ],
  recibido: 30000,
};
const notaEjemplo: NotaCredito = {
  codigo: "N9A8B7C6D5E", ventaCodigo: "V9F3A2C7B", sucursal: "zelarrayan", creada: ahora, montoInicial: 13930, saldo: 13930, ajustePct: -30, estado: "vigente",
  items: [{ nombre: "Remera buenos tiempos", cantidad: 1, monto: 13930, falladas: 0 }],
};

export default function TicketsPrueba() {
  // Para probar una impresora de tickets sin registrar ninguna venta: imprime el ejemplo con el mismo tamano de papel de la caja.
  const [prueba, setPrueba] = useState<"venta" | "nota" | null>(null);
  const [avisoPrueba, setAvisoPrueba] = useState("");
  useEffect(() => {
    if (!prueba) return;
    // El ticket se queda en pantalla un rato por si hubo que caer a la ventana del navegador.
    imprimirTicketPreferido(() => (prueba === "venta" ? ticketVentaEscpos(ventaEjemplo) : ticketNotaEscpos(notaEjemplo))).then((m) => {
      setAvisoPrueba(m);
      setTimeout(() => setPrueba(null), 1500);
    });
  }, [prueba]);
  return (
    <>
      <h1>Vista previa de tickets</h1>
      <p className="aviso" style={{ marginTop: -8 }}>
        Datos de ejemplo, no se guarda nada. Probá escanear los códigos de barras desde la pantalla: en Venta o en Devolución tendrían que leerse.
        El ticket de venta lleva el código <strong>V9F3A2C7B</strong> y la nota de crédito <strong>N9A8B7C6D5E</strong> (no existen en el sistema).
      </p>
      <div className="fila no-print" style={{ margin: "8px 0 16px" }}>
        <button className="principal" onClick={() => setPrueba("venta")}>Imprimir ticket de prueba</button>
        <button onClick={() => setPrueba("nota")}>Imprimir nota de prueba</button>
        <span className="aviso">Sale directo por la impresora de tickets (agente de impresión). No guarda nada.</span>
        {avisoPrueba && <span className="error" role="alert">{avisoPrueba}</span>}
      </div>
      <div className="fila no-print" style={{ alignItems: "flex-start", gap: 24, flexWrap: "wrap" }}>
        <div><p className="rotulo">Ticket de venta</p><div style={{ boxShadow: "0 0 0 1px var(--borde)" }}><Ticket venta={ventaEjemplo} /></div></div>
        <div><p className="rotulo">Nota de crédito</p><div style={{ boxShadow: "0 0 0 1px var(--borde)" }}><TicketNota nota={notaEjemplo} /></div></div>
      </div>
      {prueba && (
        <div className="solo-ticket" aria-hidden="true">
          {prueba === "venta" ? <Ticket venta={ventaEjemplo} /> : <TicketNota nota={notaEjemplo} />}
        </div>
      )}
    </>
  );
}

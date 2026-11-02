"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { listarVentas, reimprimirTicketVenta } from "@/app/actions";
import { Ticket, type DatosTicket } from "@/components/Ticket";
import { ticketVentaEscpos } from "@/lib/escpos";
import { useSucursal } from "@/lib/hooks";
import { imprimirTicketPreferido } from "@/lib/imprimirTicket";
import { nombreSucursal, pesos, type VentaListada } from "@/lib/util";

const dos = (n: number) => String(n).padStart(2, "0");
const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`; };
const hora = (iso: string) => { const d = new Date(iso); return `${dos(d.getDate())}/${dos(d.getMonth() + 1)} ${dos(d.getHours())}:${dos(d.getMinutes())}`; };
// Del mes "2026-11" salen el primer y el ultimo dia.
function rangoMes(mes: string) {
  const [a, m] = mes.split("-").map(Number);
  return { desde: `${mes}-01`, hasta: `${mes}-${dos(new Date(a, m, 0).getDate())}` };
}

export default function VentasPage() {
  const [sucursal] = useSucursal();
  const [modo, setModo] = useState<"dia" | "mes">("dia");
  const [dia, setDia] = useState(hoy);
  const [mes, setMes] = useState(() => hoy().slice(0, 7));
  const [ventas, setVentas] = useState<VentaListada[] | null>(null);
  const [error, setError] = useState("");
  const [filtro, setFiltro] = useState("");
  const [nuevasPrimero, setNuevasPrimero] = useState(false);
  const [reimpreso, setReimpreso] = useState<DatosTicket | null>(null);
  const [aviso, setAviso] = useState("");
  const [imprimiendo, setImprimiendo] = useState("");

  const { desde, hasta } = modo === "dia" ? { desde: dia, hasta: dia } : mes ? rangoMes(mes) : { desde: "", hasta: "" };
  useEffect(() => {
    if (!desde) return;
    let vivo = true;
    listarVentas(sucursal, desde, hasta).then((r) => {
      if (!vivo) return;
      if (!r.ok) { setError(r.motivo); setVentas([]); return; }
      setError("");
      setVentas(r.ventas);
    });
    return () => { vivo = false; };
  }, [sucursal, desde, hasta]);

  const lista = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    const f = (ventas ?? []).filter((v) => !q || v.codigo.toLowerCase().includes(q) || v.items.some((i) => i.nombre.toLowerCase().includes(q)));
    return nuevasPrimero ? [...f].reverse() : f;
  }, [ventas, filtro, nuevasPrimero]);
  const total = lista.reduce((s, v) => s + v.total, 0);

  async function reimprimir(codigo: string) {
    setImprimiendo(codigo);
    setAviso("");
    const r = await reimprimirTicketVenta(codigo);
    if (!r.ok) { setImprimiendo(""); return setAviso(r.motivo); }
    setReimpreso(r.venta);
    const m = await imprimirTicketPreferido(() => ticketVentaEscpos(r.venta));
    setAviso(m || `Ticket ${codigo} reimpreso.`);
    setImprimiendo("");
    // Se deja un rato en pantalla por si hubo que caer a la ventana del navegador.
    setTimeout(() => setReimpreso(null), 2000);
  }

  return (
    <>
      <h1>Ventas · {nombreSucursal(sucursal)}</h1>
      <p className="aviso no-print" style={{ marginTop: -8 }}>
        Para cuando el cliente perdió el ticket: encontrá su compra por fecha y, desde acá, la devolvés o reimprimís el ticket. Van de la más vieja a la más nueva.
      </p>
      <div className="fila no-print" style={{ gap: 12, flexWrap: "wrap", margin: "8px 0 12px" }}>
        <span className="fila" style={{ gap: 6 }}>
          <button className={modo === "dia" ? "principal" : ""} onClick={() => setModo("dia")}>Por día</button>
          <button className={modo === "mes" ? "principal" : ""} onClick={() => setModo("mes")}>Por mes</button>
        </span>
        {modo === "dia"
          ? <input type="date" value={dia} max={hoy()} onChange={(e) => setDia(e.target.value)} />
          : <input type="month" value={mes} max={hoy().slice(0, 7)} onChange={(e) => setMes(e.target.value)} />}
        <input type="search" value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Filtrar por prenda o ticket" style={{ flex: 1, minWidth: 200 }} />
        <label className="fila" style={{ gap: 6, fontSize: 14 }}>
          <input type="checkbox" checked={nuevasPrimero} onChange={(e) => setNuevasPrimero(e.target.checked)} /> Más nuevas primero
        </label>
      </div>
      <p className="error no-print" role="alert">{error}</p>
      {aviso && <p className="aviso no-print" role="status">{aviso}</p>}

      <div className="tarjeta no-print">
        {ventas === null ? <p className="aviso">Cargando…</p> : lista.length === 0 ? <p className="aviso">No hay ventas en este período{filtro ? " con ese filtro" : ""}.</p> : (
          <>
            <p style={{ marginTop: 0 }}><strong>{lista.length} venta{lista.length === 1 ? "" : "s"}</strong> · {pesos(total)}</p>
            <table>
              <thead><tr><th>Fecha</th><th>Ticket</th><th>Prendas</th><th>Pagó</th><th className="der">Total</th><th /></tr></thead>
              <tbody>
                {lista.map((v) => (
                  <tr key={v.codigo}>
                    <td style={{ whiteSpace: "nowrap" }}>{hora(v.fecha)}</td>
                    <td><code>{v.codigo}</code>{v.devuelta && <span className="interno"> · con devolución</span>}</td>
                    <td>{v.items.map((i) => `${i.cantidad} x ${i.nombre}`).join(", ")}</td>
                    <td>{v.medios}</td>
                    <td className="der">{pesos(v.total)}</td>
                    <td style={{ minWidth: 190 }}>
                      <span className="fila" style={{ gap: 6 }}>
                        <Link className="boton" href={`/devolucion?codigo=${v.codigo}`}>Devolver</Link>
                        <button className="chico" onClick={() => reimprimir(v.codigo)} disabled={imprimiendo === v.codigo}>{imprimiendo === v.codigo ? "Imprimiendo…" : "Reimprimir"}</button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
      {reimpreso && (
        <div className="solo-ticket" aria-hidden="true">
          <Ticket venta={reimpreso} />
        </div>
      )}
    </>
  );
}

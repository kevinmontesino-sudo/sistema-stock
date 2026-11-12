"use client";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { anularVentaAccion, listarVentas, reimprimirTicketVenta } from "@/app/actions";
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
  // Anular un ticket equivocado: se abre un renglon con el motivo (obligatorio) y recien ahi se confirma.
  const [anulando, setAnulando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [version, setVersion] = useState(0);

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
  }, [sucursal, desde, hasta, version]);

  const lista = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    const f = (ventas ?? []).filter((v) => !q || v.codigo.toLowerCase().includes(q) || v.items.some((i) => i.nombre.toLowerCase().includes(q)));
    return nuevasPrimero ? [...f].reverse() : f;
  }, [ventas, filtro, nuevasPrimero]);
  const vigentes = lista.filter((v) => !v.anulada);
  const total = vigentes.reduce((s, v) => s + v.total, 0);

  async function anular(v: VentaListada) {
    if (ocupado) return;
    setOcupado(true);
    setAviso("");
    const r = await anularVentaAccion(v.codigo, motivo);
    setOcupado(false);
    if (!r.ok) return setAviso(r.motivo);
    setAnulando(null);
    setMotivo("");
    setAviso(`Ticket ${v.codigo} anulado: ${r.anulacion.unidades} prenda${r.anulacion.unidades === 1 ? "" : "s"} vuelve${r.anulacion.unidades === 1 ? "" : "n"} al stock y ${pesos(r.anulacion.total)} dejan de contar en la caja.`);
    setVersion((n) => n + 1);
  }

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
            <p style={{ marginTop: 0 }}><strong>{vigentes.length} venta{vigentes.length === 1 ? "" : "s"}</strong> · {pesos(total)}{vigentes.length < lista.length && <span className="interno"> · {lista.length - vigentes.length} anulada{lista.length - vigentes.length === 1 ? "" : "s"} (no suman)</span>}</p>
            <table>
              <thead><tr><th>Fecha</th><th>Ticket</th><th>Prendas</th><th>Pagó</th><th className="der">Total</th><th /></tr></thead>
              <tbody>
                {lista.map((v) => (
                  <Fragment key={v.codigo}>
                  <tr style={v.anulada ? { opacity: 0.55, textDecoration: "line-through" } : undefined}>
                    <td style={{ whiteSpace: "nowrap" }}>{hora(v.fecha)}</td>
                    <td><code>{v.codigo}</code>{v.anulada ? <strong style={{ textDecoration: "none", display: "inline-block" }}> · ANULADA</strong> : v.devuelta && <span className="interno"> · con devolución</span>}</td>
                    <td>{v.items.map((i) => `${i.cantidad} x ${i.nombre}`).join(", ")}</td>
                    <td>{v.medios}</td>
                    <td className="der" style={{ whiteSpace: "nowrap" }}>{pesos(v.total)}</td>
                    <td style={{ minWidth: 190, textDecoration: "none" }}>
                      {!v.anulada && (
                        <span className="fila" style={{ gap: 6, flexWrap: "wrap" }}>
                          <Link className="boton" href={`/devolucion?codigo=${v.codigo}`}>Devolver</Link>
                          <button className="chico" onClick={() => reimprimir(v.codigo)} disabled={imprimiendo === v.codigo}>{imprimiendo === v.codigo ? "Imprimiendo…" : "Reimprimir"}</button>
                          {!v.devuelta && <button className="chico" onClick={() => { setAnulando(anulando === v.codigo ? null : v.codigo); setMotivo(""); setAviso(""); }}>Anular</button>}
                        </span>
                      )}
                    </td>
                  </tr>
                  {anulando === v.codigo && (
                    <tr>
                      <td colSpan={6}>
                        <form className="fila" style={{ gap: 8, flexWrap: "wrap" }} onSubmit={(e) => { e.preventDefault(); anular(v); }}>
                          <strong>Anular {v.codigo} ({pesos(v.total)}):</strong>
                          <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus maxLength={200}
                            placeholder="Motivo (ej: se cobró de más, prenda equivocada)" style={{ flex: 1, minWidth: 220 }} />
                          <button type="submit" className="principal" disabled={ocupado || motivo.trim().length < 5}>{ocupado ? "Anulando…" : "Confirmar anulación"}</button>
                          <button type="button" className="chico" onClick={() => setAnulando(null)}>Cancelar</button>
                        </form>
                        {motivo.length > 0 && motivo.trim().length < 5 && <p className="aviso" style={{ margin: "6px 0 0" }}>El motivo tiene que tener al menos 5 letras.</p>}
                        <p className="aviso" style={{ margin: "6px 0 0" }}>Las prendas vuelven al stock y la venta deja de contar en la caja y los informes. Queda registrada con el motivo. No se puede deshacer: si fue un error, se vuelve a vender.</p>
                      </td>
                    </tr>
                  )}
                  </Fragment>
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

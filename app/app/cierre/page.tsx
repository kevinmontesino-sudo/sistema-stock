"use client";
import { useCallback, useEffect, useState } from "react";
import { cerrarCajaAccion, datosCierre } from "@/app/actions";
import { ticketCierreEscpos } from "@/lib/escpos";
import { useSucursal } from "@/lib/hooks";
import { imprimirTicketPreferido } from "@/lib/imprimirTicket";
import type { CierreCaja, ResumenDia } from "@/lib/cierre";
import { nombreSucursal, pesos } from "@/lib/util";

const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/\./g, "").replace(",", ".")));
const fechaLarga = (dia: string) => { const [a, m, d] = dia.split("-"); return `${d}/${m}/${a}`; };
const signo = (n: number) => (n === 0 ? "OK, sin diferencia" : n > 0 ? `Sobran ${pesos(n)}` : `Faltan ${pesos(-n)}`);

export default function CierrePage() {
  const [sucursal] = useSucursal();
  const [dia, setDia] = useState("");
  const [hoy, setHoy] = useState("");
  const [r, setR] = useState<ResumenDia | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [fondo, setFondo] = useState("");
  const [retiros, setRetiros] = useState("");
  const [motivo, setMotivo] = useState("");
  const [efectivo, setEfectivo] = useState("");
  const [otros, setOtros] = useState<Record<string, string>>({});
  const [obs, setObs] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [paraImprimir, setParaImprimir] = useState<CierreCaja | null>(null);

  const [version, setVersion] = useState(0);
  const cargar = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let vivo = true;
    datosCierre(sucursal, dia).then((x) => {
      if (!vivo) return;
      if (!x.ok) { setError(x.motivo); setR(null); return; }
      setError("");
      setHoy(x.hoy);
      setDia((p) => p || x.hoy);
      setR(x.resumen);
    });
    return () => { vivo = false; };
  }, [sucursal, dia, version]);

  const esperadoEfectivo = (num(fondo) ?? 0) + (r?.medios.find((m) => m.id === "efectivo")?.monto ?? 0) - (num(retiros) ?? 0);
  const contado = num(efectivo);
  const dif = contado === null ? null : contado - esperadoEfectivo;

  async function imprimir(c: CierreCaja, medios: ResumenDia["medios"]) {
    setParaImprimir(c);
    const m = await imprimirTicketPreferido(() => ticketCierreEscpos(c, medios));
    setAviso(m || "Ticket del cierre impreso.");
  }

  async function cerrar() {
    if (!r) return;
    if (contado === null) return setError("Contá el efectivo de la caja y escribilo.");
    const texto = dif === 0 ? "No hay diferencia." : `Hay una diferencia: ${signo(dif ?? 0)}.`;
    if (!window.confirm(`¿Cerrar la caja de ${nombreSucursal(sucursal)} del ${fechaLarga(r.dia)}?\n\nEfectivo contado: ${pesos(contado)}. ${texto}\n\nUna vez cerrada NO se puede corregir.`)) return;
    setGuardando(true);
    setError("");
    const x = await cerrarCajaAccion(sucursal, r.dia, {
      fondoInicial: num(fondo) ?? 0, retiros: num(retiros) ?? 0, retirosMotivo: motivo, efectivoContado: contado,
      otrosContados: Object.fromEntries(Object.entries(otros).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, num(v)])), observaciones: obs,
    });
    setGuardando(false);
    if (!x.ok) return setError(x.motivo);
    cargar();
    await imprimir(x.cierre, r.medios);
  }

  const c = r?.cierre ?? null;
  return (
    <>
      <h1>Cierre de caja · {nombreSucursal(sucursal)}</h1>
      <p className="aviso no-print" style={{ marginTop: -8 }}>Al final del día: contá el efectivo de la caja y cerrá. El sistema compara con lo que se vendió y deja el ticket impreso.</p>
      <div className="fila no-print" style={{ margin: "8px 0 12px" }}>
        <label className="fila" style={{ gap: 6 }}>Día <input type="date" value={dia} max={hoy || undefined} onChange={(e) => { setDia(e.target.value); setAviso(""); }} /></label>
      </div>
      <p className="error no-print" role="alert">{error}</p>
      {aviso && <p className="aviso no-print" role="status">{aviso}</p>}
      {!r ? <p className="aviso">Cargando…</p> : (
        <>
          <div className="tarjeta no-print">
            <p style={{ marginTop: 0 }}><strong>{r.ventas} {r.ventas === 1 ? "venta" : "ventas"} · {r.unidades} prendas · {pesos(r.totalCobrado)} cobrados</strong></p>
            {r.ventas === 0 ? <p className="aviso">No hubo ventas este día.</p> : (
              <table>
                <thead><tr><th>Medio de pago</th><th className="der">Ventas</th><th className="der">Cobrado (sistema)</th>{c ? <th className="der">Lo que contó el local</th> : <th className="der">Lo que contaste (opcional)</th>}</tr></thead>
                <tbody>
                  {r.medios.map((m) => (
                    <tr key={m.id}>
                      <td>{m.nombre}</td><td className="der">{m.ventas}</td><td className="der">{pesos(m.monto)}</td>
                      <td className="der">
                        {m.id === "efectivo" ? <span className="aviso">se cuenta abajo</span>
                          : c ? (c.contado[m.id] !== undefined ? pesos(c.contado[m.id]) : "—")
                          : <input inputMode="numeric" value={otros[m.id] ?? ""} onChange={(e) => setOtros({ ...otros, [m.id]: e.target.value })} placeholder="mirar el posnet / el banco" style={{ width: 190, textAlign: "right" }} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {r.pagadoConNotas > 0 && <p className="aviso">Pagado con notas de crédito (no es plata en caja): {pesos(r.pagadoConNotas)}.</p>}
            {r.notasEmitidas > 0 && <p className="aviso">Notas de crédito emitidas hoy: {r.notasEmitidas} por {pesos(r.notasMonto)} (no mueven plata).</p>}
          </div>

          {c ? (
            <div className="tarjeta no-print" style={{ marginTop: 12 }}>
              <p style={{ marginTop: 0 }}><strong>Caja cerrada</strong> por {c.cerradoPor} el {new Date(c.creado).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}</p>
              <table><tbody>
                <tr><td>Efectivo con el que abrió</td><td className="der">{pesos(c.fondoInicial)}</td></tr>
                <tr><td>+ Cobrado en efectivo</td><td className="der">{pesos(c.esperado.efectivo ?? 0)}</td></tr>
                {c.retiros > 0 && <tr><td>− Retiros ({c.retirosMotivo})</td><td className="der">{pesos(c.retiros)}</td></tr>}
                <tr><td>Tendría que haber</td><td className="der">{pesos(c.efectivoEsperado)}</td></tr>
                <tr><td>Contado</td><td className="der">{pesos(c.efectivoContado)}</td></tr>
                <tr><td><strong>Diferencia</strong></td><td className="der"><strong className={c.diferencia === 0 ? "ok" : "error"}>{signo(c.diferencia)}</strong></td></tr>
              </tbody></table>
              {c.observaciones && <p className="aviso">Observaciones: {c.observaciones}</p>}
              {r.ventasDespuesDelCierre > 0 && <p className="error">Se hicieron {r.ventasDespuesDelCierre} venta(s) después de cerrar: no figuran en este cierre.</p>}
              <button onClick={() => imprimir(c, r.medios)}>Reimprimir ticket del cierre</button>
            </div>
          ) : (
            <div className="tarjeta no-print" style={{ marginTop: 12 }}>
              <p style={{ marginTop: 0 }}><strong>Contá el efectivo</strong></p>
              <div className="fila" style={{ alignItems: "flex-start", gap: 16 }}>
                <label className="campo"><span>Efectivo con el que abriste la caja (cambio)</span><input inputMode="numeric" value={fondo} onChange={(e) => setFondo(e.target.value)} placeholder="0" /></label>
                <label className="campo"><span>Plata que sacaste de la caja (gastos, depósito)</span><input inputMode="numeric" value={retiros} onChange={(e) => setRetiros(e.target.value)} placeholder="0" /></label>
                {(num(retiros) ?? 0) > 0 && <label className="campo"><span>¿Para qué?</span><input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="ej. depósito al banco" /></label>}
              </div>
              <p>En el sistema debería haber en efectivo: <strong>{pesos(esperadoEfectivo)}</strong></p>
              <label className="campo"><span>Efectivo que hay AHORA en la caja (contalo)</span><input inputMode="numeric" value={efectivo} onChange={(e) => setEfectivo(e.target.value)} placeholder="0" style={{ fontSize: 22, maxWidth: 260 }} /></label>
              {dif !== null && <p><strong className={dif === 0 ? "ok" : "error"}>{signo(dif)}</strong></p>}
              <label className="campo"><span>Observaciones (opcional)</span><input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="ej. se dio mal un vuelto" /></label>
              <button className="principal" onClick={cerrar} disabled={guardando || contado === null}>{guardando ? "Cerrando…" : "Cerrar caja e imprimir"}</button>
            </div>
          )}
        </>
      )}
      {paraImprimir && r && (
        <div className="solo-ticket" aria-hidden="true">
          <div className="ticket">
            <h3>{nombreSucursal(paraImprimir.sucursal)}<br />CIERRE DE CAJA {fechaLarga(paraImprimir.dia)}</h3>
            <div className="centro">Cerró {paraImprimir.cerradoPor}</div><hr />
            <div className="linea"><span>{paraImprimir.ventas} ventas · {paraImprimir.unidades} prendas</span></div>
            {r.medios.map((m) => <div className="linea" key={m.id}><span>{m.nombre} ({m.ventas})</span><span>{pesos(m.monto)}</span></div>)}
            <hr />
            <div className="linea"><span>Fondo</span><span>{pesos(paraImprimir.fondoInicial)}</span></div>
            {paraImprimir.retiros > 0 && <div className="linea"><span>Retiros</span><span>{pesos(paraImprimir.retiros)}</span></div>}
            <div className="linea"><span>Debería haber</span><span>{pesos(paraImprimir.efectivoEsperado)}</span></div>
            <div className="linea"><span>Contado</span><span>{pesos(paraImprimir.efectivoContado)}</span></div>
            <div className="linea total-t"><span>{signo(paraImprimir.diferencia)}</span></div>
          </div>
        </div>
      )}
    </>
  );
}

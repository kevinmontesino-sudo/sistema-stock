"use client";
import { useCallback, useEffect, useState } from "react";
import { cerrarCajaAccion, datosCierre, retirarEfectivoAccion } from "@/app/actions";
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
  const [dejado, setDejado] = useState("");
  const [fondoTocado, setFondoTocado] = useState(false);
  const [otros, setOtros] = useState<Record<string, string>>({});
  const [obs, setObs] = useState("");
  const [retOrigen, setRetOrigen] = useState<"caja" | "caja_fuerte">("caja");
  const [retMonto, setRetMonto] = useState("");
  const [retQuien, setRetQuien] = useState("");
  const [retDestino, setRetDestino] = useState("Depósito");
  const [retMotivo, setRetMotivo] = useState("");
  const [retEnviando, setRetEnviando] = useState(false);
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
      if (x.resumen.fondoSugerido !== null) setFondo((f) => (f === "" ? String(x.resumen.fondoSugerido) : f));
    });
    return () => { vivo = false; };
  }, [sucursal, dia, version]);

  const k = (n: number) => (r && r.retirosParciales.total > 0 && n >= 3 ? n + 1 : n); // el paso de cierres parciales aparece solo si hubo
  const esperadoEfectivo = (num(fondo) ?? 0) + (r?.medios.find((m) => m.id === "efectivo")?.monto ?? 0) - (num(retiros) ?? 0) - (r?.retirosParciales.total ?? 0);
  const contado = num(efectivo);
  const dif = contado === null ? null : contado - esperadoEfectivo;
  const dejadoN = num(dejado);
  const cajaFuerte = contado !== null && dejadoN !== null ? contado - dejadoN : null;

  async function imprimir(c: CierreCaja, medios: ResumenDia["medios"]) {
    setParaImprimir(c);
    const m = await imprimirTicketPreferido(() => ticketCierreEscpos(c, medios));
    setAviso(m || "Ticket del cierre impreso.");
  }

  async function retirar(e: React.FormEvent) {
    e.preventDefault();
    const m = num(retMonto);
    if (m === null || !Number.isInteger(m) || m < 1) return setError("Poné cuánta plata se lleva, en números.");
    if (retQuien.trim().length < 2) return setError("Poné quién se lleva la plata.");
    if (!window.confirm(`¿Confirmás que ${retQuien.trim()} se lleva ${pesos(m)} de ${retOrigen === "caja" ? "la caja" : "la caja fuerte"} de ${nombreSucursal(sucursal)}${retDestino.trim() ? ` (va a ${retDestino.trim()})` : ""}? No se puede borrar después.`)) return;
    setRetEnviando(true);
    setError("");
    const x = await retirarEfectivoAccion(sucursal, retOrigen, m, retQuien, retDestino, retMotivo);
    setRetEnviando(false);
    if (!x.ok) return setError(x.motivo);
    setAviso(`Anotado: ${retQuien.trim()} se lleva ${pesos(m)}.`);
    setRetMonto(""); setRetQuien(""); setRetMotivo("");
    cargar();
  }

  async function cerrar() {
    if (!r) return;
    if (contado === null) return setError("Contá el efectivo de la caja y escribilo.");
    if (dejadoN === null) return setError("Escribí cuánto dejás en la caja para mañana (si no dejás nada, poné 0).");
    if (dejadoN > contado) return setError("No podés dejar en la caja más de lo que contaste.");
    const texto = dif === 0 ? "No hay diferencia." : `Hay una diferencia: ${signo(dif ?? 0)}.`;
    if (!window.confirm(`¿Cerrar la caja de ${nombreSucursal(sucursal)} del ${fechaLarga(r.dia)}?\n\nEfectivo contado: ${pesos(contado)}. ${texto}\nQueda en la caja para mañana: ${pesos(dejadoN)}. A la caja fuerte: ${pesos(contado - dejadoN)}.\n\nUna vez cerrada NO se puede corregir.`)) return;
    setGuardando(true);
    setError("");
    const x = await cerrarCajaAccion(sucursal, r.dia, {
      fondoInicial: num(fondo) ?? 0, retiros: num(retiros) ?? 0, retirosMotivo: motivo, efectivoContado: contado, fondoSiguiente: dejadoN,
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

          {r.dia === hoy && (
            <form className="tarjeta no-print" onSubmit={retirar} style={{ marginTop: 12, display: "grid", gap: 10, maxWidth: 520 }}>
              <p style={{ margin: 0 }}><strong>Retiro de efectivo</strong> <span className="aviso">· cada vez que alguien se lleva plata (cierre parcial, o de la caja fuerte)</span></p>
              <label className="campo"><span><strong>1. De dónde sale la plata</strong></span>
                <select value={c ? "caja_fuerte" : retOrigen} onChange={(e) => setRetOrigen(e.target.value as "caja" | "caja_fuerte")} disabled={!!c}>
                  <option value="caja">De la caja del día (cierre parcial)</option>
                  <option value="caja_fuerte">De la caja fuerte</option>
                </select>
                {c && <small className="aviso">La caja de hoy ya está cerrada: solo se puede retirar de la caja fuerte.</small>}
              </label>
              <label className="campo"><span><strong>2. Cuánta plata se lleva</strong></span>
                <input inputMode="numeric" value={retMonto} onChange={(e) => setRetMonto(e.target.value)} placeholder="ej. 500000" style={{ fontSize: 22 }} />
              </label>
              <label className="campo"><span><strong>3. Quién se la lleva</strong> (el responsable)</span>
                <input value={retQuien} onChange={(e) => setRetQuien(e.target.value)} placeholder="ej. Hugo" maxLength={80} />
              </label>
              <label className="campo"><span><strong>4. A dónde va</strong></span>
                <input value={retDestino} onChange={(e) => setRetDestino(e.target.value)} maxLength={60} list="destinos-retiro" />
                <datalist id="destinos-retiro"><option value="Depósito" /><option value="Banco" /></datalist>
              </label>
              <label className="campo"><span><strong>5. Para qué</strong> (opcional)</span>
                <input value={retMotivo} onChange={(e) => setRetMotivo(e.target.value)} maxLength={200} />
              </label>
              <button disabled={retEnviando || num(retMonto) === null || retQuien.trim().length < 2}>{retEnviando ? "Anotando…" : "Anotar retiro"}</button>
              {r.retirosParciales.lista.length + r.retirosCajaFuerte.length > 0 && (
                <table>
                  <thead><tr><th>Hora</th><th>Sale de</th><th>Se lo llevó</th><th>A dónde</th><th className="der">Monto</th></tr></thead>
                  <tbody>
                    {[...r.retirosParciales.lista, ...r.retirosCajaFuerte].sort((x, y) => x.creado.localeCompare(y.creado)).map((x) => (
                      <tr key={x.id}><td>{new Date(x.creado).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit" })}</td>
                        <td>{x.origen === "caja" ? "Caja" : "Caja fuerte"}</td><td><strong>{x.retiradoPor}</strong></td><td>{x.destino ?? "—"}</td><td className="der">{pesos(x.monto)}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </form>
          )}

          {c ? (
            <div className="tarjeta no-print" style={{ marginTop: 12 }}>
              <p style={{ marginTop: 0 }}><strong>Caja cerrada</strong> por {c.cerradoPor} el {new Date(c.creado).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}</p>
              <table><tbody>
                <tr><td>Abrió la caja con</td><td className="der">{pesos(c.fondoInicial)}</td></tr>
                <tr><td>+ Cobrado en efectivo</td><td className="der">{pesos(c.esperado.efectivo ?? 0)}</td></tr>
                {c.retiros > 0 && <tr><td>− Pagos ({c.retirosMotivo})</td><td className="der">{pesos(c.retiros)}</td></tr>}
                <tr><td>Tendría que haber</td><td className="der">{pesos(c.efectivoEsperado)}</td></tr>
                <tr><td>Contó al cerrar</td><td className="der">{pesos(c.efectivoContado)}</td></tr>
                <tr><td><strong>Diferencia</strong></td><td className="der"><strong className={c.diferencia === 0 ? "ok" : "error"}>{signo(c.diferencia)}</strong></td></tr>
                {c.fondoSiguiente !== null && <>
                  <tr><td>Queda en la caja para mañana (vuelto)</td><td className="der">{pesos(c.fondoSiguiente)}</td></tr>
                  <tr><td>A la caja fuerte de la empresa</td><td className="der">{pesos(c.efectivoContado - c.fondoSiguiente)}</td></tr>
                </>}
              </tbody></table>
              {c.observaciones && <p className="aviso">Observaciones: {c.observaciones}</p>}
              {r.ventasDespuesDelCierre > 0 && <p className="error">Se hicieron {r.ventasDespuesDelCierre} venta(s) después de cerrar: no figuran en este cierre.</p>}
              <button onClick={() => imprimir(c, r.medios)}>Reimprimir ticket del cierre</button>
            </div>
          ) : (
            <div className="tarjeta no-print" style={{ marginTop: 12 }}>
              <p style={{ marginTop: 0 }}><strong>Cierre del efectivo</strong></p>
              <div style={{ display: "grid", gap: 12, maxWidth: 460 }}>
                <label className="campo"><span><strong>1. Con cuánto abriste la caja</strong> (el cambio con el que arrancaste)</span>
                  <input inputMode="numeric" value={fondo} onChange={(e) => { setFondo(e.target.value); setFondoTocado(true); }} placeholder="0" />
                  {r.fondoSugerido !== null && !fondoTocado && <small className="aviso">Es lo que dejó el último cierre.</small>}
                  {r.fondoSugerido !== null && fondoTocado && num(fondo) !== r.fondoSugerido && <small className="error">El último cierre dejó {pesos(r.fondoSugerido)}: revisá este número.</small>}
                </label>
                <div className="campo"><span><strong>2. Cobrado en efectivo hoy</strong> (lo calcula el sistema, no hay que escribir nada)</span>
                  <div className="monto-verde">{pesos(r.medios.find((m) => m.id === "efectivo")?.monto ?? 0)}</div>
                </div>
                {r.retirosParciales.total > 0 && (
                  <div className="campo"><span><strong>3. Ya retirado durante el día (cierres parciales)</strong> (lo suma el sistema, no hay que escribir nada)</span>
                    <div className="monto-verde" style={{ color: "var(--error)" }}>−{pesos(r.retirosParciales.total)}</div>
                    <small className="aviso">{r.retirosParciales.lista.map((x) => `${x.retiradoPor} ${pesos(x.monto)}${x.destino ? ` → ${x.destino}` : ""}`).join(" · ")}</small>
                  </div>
                )}
                <label className="campo"><span><strong>{k(3)}. Pagos o gastos que salieron de la caja</strong> (si no hubo, dejalo vacío)</span>
                  <input inputMode="numeric" value={retiros} onChange={(e) => setRetiros(e.target.value)} placeholder="0" />
                </label>
                {(num(retiros) ?? 0) > 0 && <label className="campo"><span>¿Para qué fueron?</span><input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="ej. pago a proveedor" /></label>}
                <div className="caja-esperada"><span>Con eso, en la caja tendría que haber</span><div className="monto-verde grande">{pesos(esperadoEfectivo)}</div></div>
                <label className="campo"><span><strong>{k(4)}. Cuánto hay en la caja al cerrar</strong> (contá TODO, incluso el cambio con el que abriste, antes de sacar nada)</span>
                  <input inputMode="numeric" value={efectivo} onChange={(e) => setEfectivo(e.target.value)} placeholder="0" style={{ fontSize: 22, maxWidth: 260 }} />
                </label>
                {dif !== null && <p style={{ margin: 0 }}><strong className={dif === 0 ? "ok" : "error"}>{signo(dif)}</strong></p>}
                <label className="campo"><span><strong>{k(5)}. Cuánto dejás en la caja para el vuelto de mañana</strong></span>
                  <input inputMode="numeric" value={dejado} onChange={(e) => setDejado(e.target.value)} placeholder="ej. 100000" style={{ fontSize: 22, maxWidth: 260 }} />
                </label>
                {cajaFuerte !== null && (cajaFuerte >= 0
                  ? <p style={{ margin: 0 }}><strong>El resto, {pesos(cajaFuerte)}, va a la caja fuerte de la empresa.</strong></p>
                  : <p className="error" style={{ margin: 0 }}>No podés dejar más de lo que contaste.</p>)}
              </div>
              <label className="campo"><span>Observaciones (opcional)</span><input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="ej. se dio mal un vuelto" /></label>
              <button className="principal" onClick={cerrar} disabled={guardando || contado === null || dejadoN === null}>{guardando ? "Cerrando…" : "Cerrar caja e imprimir"}</button>
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
            <div className="linea"><span>Abrió con</span><span>{pesos(paraImprimir.fondoInicial)}</span></div>
            {paraImprimir.retiros > 0 && <div className="linea"><span>Pagos</span><span>{pesos(paraImprimir.retiros)}</span></div>}
            <div className="linea"><span>Debería haber</span><span>{pesos(paraImprimir.efectivoEsperado)}</span></div>
            <div className="linea"><span>Contó al cerrar</span><span>{pesos(paraImprimir.efectivoContado)}</span></div>
            <div className="linea total-t"><span>{signo(paraImprimir.diferencia)}</span></div>
            {paraImprimir.fondoSiguiente !== null && <>
              <div className="linea"><span>Queda en caja p/ mañana</span><span>{pesos(paraImprimir.fondoSiguiente)}</span></div>
              <div className="linea"><span>A caja fuerte</span><span>{pesos(paraImprimir.efectivoContado - paraImprimir.fondoSiguiente)}</span></div>
            </>}
          </div>
        </div>
      )}
    </>
  );
}

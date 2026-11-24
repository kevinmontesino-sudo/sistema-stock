"use client";
import { useEffect, useState } from "react";
import { datosCierre, retirarEfectivoAccion } from "@/app/actions";
import { useSucursal } from "@/lib/hooks";
import type { ResumenDia } from "@/lib/cierre";
import { fmtMonto, nombreSucursal, pesos } from "@/lib/util";

// Retiro de efectivo: cada vez que alguien se lleva plata. Es aparte del cierre de caja.
//  - Cierre parcial: sale de la caja durante el dia (se descuenta solo del cierre de ese dia).
//  - De la caja fuerte: baja lo que "tendria que haber" en ella.
export default function Retiros() {
  const [sucursal] = useSucursal();
  const [r, setR] = useState<ResumenDia | null>(null);
  const [origen, setOrigen] = useState<"caja" | "caja_fuerte">("caja");
  const [monto, setMonto] = useState("");
  const [quien, setQuien] = useState("");
  const [destino, setDestino] = useState("Depósito");
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let vivo = true;
    datosCierre(sucursal, "").then((x) => {
      if (!vivo) return;
      if (!x.ok) { setError(x.motivo); return; }
      setR(x.resumen);
    });
    return () => { vivo = false; };
  }, [sucursal, version]);

  const cerrada = !!r?.cierre;
  const origenReal = cerrada ? "caja_fuerte" : origen;
  const t = monto.trim().replace(/\./g, "");
  const n = /^\d+$/.test(t) ? Number(t) : NaN;
  const montoOk = Number.isInteger(n) && n > 0;
  const lista = r ? [...r.retirosParciales.lista, ...r.retirosCajaFuerte].sort((x, y) => x.creado.localeCompare(y.creado)) : [];

  async function anotar(e: React.FormEvent) {
    e.preventDefault();
    setAviso(""); setError("");
    if (!montoOk) return setError("Poné cuánta plata se lleva, en números (ej. 500000).");
    if (quien.trim().length < 2) return setError("Poné quién se lleva la plata.");
    if (!window.confirm(`¿Confirmás que ${quien.trim()} se lleva ${pesos(n)} de ${origenReal === "caja" ? "la caja" : "la caja fuerte"} de ${nombreSucursal(sucursal)}${destino.trim() ? ` (va a ${destino.trim()})` : ""}? No se puede borrar después.`)) return;
    setEnviando(true);
    const x = await retirarEfectivoAccion(sucursal, origenReal, n, quien, destino, motivo);
    setEnviando(false);
    if (!x.ok) return setError(x.motivo);
    setAviso(`Anotado: ${quien.trim()} se lleva ${pesos(n)}.`);
    setMonto(""); setQuien(""); setMotivo("");
    setVersion((v) => v + 1);
  }

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 560 }}>
      <div>
        <h1>Retiro de efectivo</h1>
        <p className="aviso" style={{ marginTop: -8 }}>Local: <strong>{nombreSucursal(sucursal)}</strong>. Anotá acá cada vez que alguien se lleva plata. Es aparte del cierre de caja.</p>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {aviso && <p className="aviso" role="status">{aviso}</p>}

      <form className="tarjeta" onSubmit={anotar} style={{ display: "grid", gap: 10 }}>
        <label className="campo"><span><strong>1. De dónde sale la plata</strong></span>
          <select value={origenReal} onChange={(e) => setOrigen(e.target.value as "caja" | "caja_fuerte")} disabled={cerrada}>
            <option value="caja">De la caja del día (cierre parcial)</option>
            <option value="caja_fuerte">De la caja fuerte</option>
          </select>
          {cerrada && <small className="aviso">La caja de hoy ya está cerrada: solo se puede retirar de la caja fuerte.</small>}
        </label>
        <label className="campo"><span><strong>2. Cuánta plata se lleva</strong></span>
          <input inputMode="numeric" value={monto} onChange={(e) => setMonto(fmtMonto(e.target.value))} placeholder="ej. 500000" style={{ fontSize: 22 }} />
          {monto.trim() !== "" && !montoOk && <small className="error">Acá va solo el número (ej. 500000).</small>}
        </label>
        <label className="campo"><span><strong>3. Quién se la lleva</strong> (el responsable)</span>
          <input value={quien} onChange={(e) => setQuien(e.target.value)} placeholder="ej. Hugo" maxLength={80} />
        </label>
        <label className="campo"><span><strong>4. A dónde va</strong></span>
          <input value={destino} onChange={(e) => setDestino(e.target.value)} maxLength={60} list="destinos-retiro" />
          <datalist id="destinos-retiro"><option value="Depósito" /><option value="Banco" /></datalist>
        </label>
        <label className="campo"><span><strong>5. Para qué</strong> (opcional)</span>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} />
        </label>
        <button className="principal" disabled={enviando || !montoOk || quien.trim().length < 2}>{enviando ? "Anotando…" : "Anotar retiro"}</button>
      </form>

      <div className="tarjeta">
        <strong>Retiros de hoy en {nombreSucursal(sucursal)}</strong>
        {lista.length === 0 ? <p className="aviso">Todavía no hay retiros hoy.</p> : (
          <table>
            <thead><tr><th>Hora</th><th>Sale de</th><th>Se lo llevó</th><th>A dónde</th><th className="der">Monto</th></tr></thead>
            <tbody>
              {lista.map((x) => (
                <tr key={x.id}><td>{new Date(x.creado).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit" })}</td>
                  <td>{x.origen === "caja" ? "Caja (parcial)" : "Caja fuerte"}</td><td><strong>{x.retiradoPor}</strong></td><td>{x.destino ?? "—"}</td><td className="der">{pesos(x.monto)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import { cierreParcialAccion, datosCierre, retirarEfectivoAccion } from "@/app/actions";
import { useSucursal } from "@/lib/hooks";
import type { ResumenDia } from "@/lib/cierre";
import { fmtMonto, nombreSucursal, pesos, soloDigitos } from "@/lib/util";

// Caja fuerte, desde la caja del local:
//  1) GUARDAR EN CAJA FUERTE (cierre parcial): sale plata de la caja durante el dia y se guarda en la caja fuerte. Se descuenta de la caja del dia y suma a la caja fuerte.
//  2) SALIDA DE CAJA FUERTE: sale plata de la caja fuerte hacia otro lado (Deposito, banco...). Baja lo que tendria que haber en la caja fuerte.
// El cierre de caja del final del dia es aparte (/cierre).
const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit" });
const aNumero = (s: string) => (s === "" ? NaN : Number(s));

export default function CajaFuerteLocal() {
  const [sucursal] = useSucursal();
  const [r, setR] = useState<ResumenDia | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [version, setVersion] = useState(0);
  const [enviando, setEnviando] = useState(false);
  // guardar
  const [gMonto, setGMonto] = useState("");
  const [gQuien, setGQuien] = useState("");
  const [gNota, setGNota] = useState("");
  // salida
  const [sMonto, setSMonto] = useState("");
  const [sQuien, setSQuien] = useState("");
  const [sDestino, setSDestino] = useState("Depósito");
  const [sNota, setSNota] = useState("");

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
  const gN = aNumero(gMonto), sN = aNumero(sMonto);
  const gOk = Number.isInteger(gN) && gN > 0 && gQuien.trim().length >= 2;
  const sOk = Number.isInteger(sN) && sN > 0 && sQuien.trim().length >= 2;
  const efectivoCobrado = r?.medios.find((m) => m.id === "efectivo")?.monto ?? 0;
  const guardados = r?.retirosParciales.lista ?? [];
  const salidas = r?.retirosCajaFuerte ?? [];

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setAviso(""); setError("");
    if (!gOk) return setError("Poné cuánta plata guardás (en números) y quién la guarda.");
    if (!window.confirm(`¿Confirmás que ${gQuien.trim()} guarda ${pesos(gN)} de la caja en la caja fuerte de ${nombreSucursal(sucursal)}? Se descuenta de la caja de hoy. No se puede borrar después.`)) return;
    setEnviando(true);
    const x = await cierreParcialAccion(sucursal, gN, gQuien, gNota);
    setEnviando(false);
    if (!x.ok) return setError(x.motivo);
    setAviso(`Guardado en la caja fuerte: ${pesos(gN)} (lo guardó ${gQuien.trim()}). Ya se descontó de la caja de hoy.`);
    setGMonto(""); setGQuien(""); setGNota("");
    setVersion((v) => v + 1);
  }

  async function sacar(e: React.FormEvent) {
    e.preventDefault();
    setAviso(""); setError("");
    if (!sOk) return setError("Poné cuánta plata sale (en números) y quién se la lleva.");
    if (!window.confirm(`¿Confirmás que ${sQuien.trim()} se lleva ${pesos(sN)} de la caja fuerte de ${nombreSucursal(sucursal)}${sDestino.trim() ? ` (va a ${sDestino.trim()})` : ""}? No se puede borrar después.`)) return;
    setEnviando(true);
    const x = await retirarEfectivoAccion(sucursal, sN, sQuien, sDestino, sNota);
    setEnviando(false);
    if (!x.ok) return setError(x.motivo);
    setAviso(`Salida anotada: ${sQuien.trim()} se lleva ${pesos(sN)} de la caja fuerte.`);
    setSMonto(""); setSQuien(""); setSNota("");
    setVersion((v) => v + 1);
  }

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 560 }}>
      <div>
        <h1>Guardar en caja fuerte</h1>
        <p className="aviso" style={{ marginTop: -8 }}>Local: <strong>{nombreSucursal(sucursal)}</strong>. Cierre parcial: sacás plata de la caja y la guardás en la caja fuerte. Se descuenta de la caja del día. El cierre del final del día es aparte, en «Cierre de caja».</p>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {aviso && <p className="aviso" role="status">{aviso}</p>}

      {r && (
        <div className="tarjeta" style={{ display: "grid", gap: 4 }}>
          <span>Efectivo cobrado hoy: <strong>{pesos(efectivoCobrado)}</strong></span>
          <span>Ya guardado hoy en la caja fuerte (se descontó de la caja): <strong>{pesos(r.retirosParciales.total)}</strong></span>
        </div>
      )}

      {cerrada ? (
        <p className="alerta" role="status">La caja de hoy ya está cerrada: no se puede guardar más plata hoy. El cierre ya mandó todo a la caja fuerte.</p>
      ) : (
        <form className="tarjeta" onSubmit={guardar} style={{ display: "grid", gap: 10 }}>
          <strong style={{ fontSize: 18 }}>Guardar en caja fuerte</strong>
          <label className="campo"><span><strong>1. Cuánta plata guardás</strong></span>
            <input inputMode="numeric" value={fmtMonto(gMonto)} onChange={(e) => setGMonto(soloDigitos(e.target.value))} placeholder="ej. 500.000" style={{ fontSize: 22 }} />
          </label>
          <label className="campo"><span><strong>2. Quién la guarda</strong> (el responsable)</span>
            <input value={gQuien} onChange={(e) => setGQuien(e.target.value)} placeholder="ej. Hugo" maxLength={80} />
          </label>
          <label className="campo"><span><strong>3. Nota</strong> (opcional)</span>
            <input value={gNota} onChange={(e) => setGNota(e.target.value)} maxLength={200} />
          </label>
          <button className="principal" disabled={enviando || !gOk}>{enviando ? "Guardando…" : "Guardar en caja fuerte"}</button>
        </form>
      )}

      <div className="tarjeta">
        <strong>Guardado hoy en la caja fuerte · {nombreSucursal(sucursal)}</strong>
        {guardados.length === 0 ? <p className="aviso">Todavía no se guardó nada hoy.</p> : (
          <table>
            <thead><tr><th>Hora</th><th>Lo guardó</th><th>Nota</th><th className="der">Monto</th></tr></thead>
            <tbody>
              {guardados.map((x) => (
                <tr key={x.id}><td>{hora(x.creado)}</td><td><strong>{x.retiradoPor}</strong></td><td>{x.motivo ?? "—"}</td><td className="der">{pesos(x.monto)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <form className="tarjeta" onSubmit={sacar} style={{ display: "grid", gap: 10 }}>
        <strong style={{ fontSize: 18 }}>Salida de caja fuerte</strong>
        <span className="aviso">Cuando alguien se lleva plata de la caja fuerte (al Depósito, al banco…).</span>
        <label className="campo"><span><strong>1. Cuánta plata sale</strong></span>
          <input inputMode="numeric" value={fmtMonto(sMonto)} onChange={(e) => setSMonto(soloDigitos(e.target.value))} placeholder="ej. 500.000" style={{ fontSize: 22 }} />
        </label>
        <label className="campo"><span><strong>2. Quién se la lleva</strong> (el responsable)</span>
          <input value={sQuien} onChange={(e) => setSQuien(e.target.value)} placeholder="ej. Hugo" maxLength={80} />
        </label>
        <label className="campo"><span><strong>3. A dónde va</strong></span>
          <input value={sDestino} onChange={(e) => setSDestino(e.target.value)} maxLength={60} list="destinos-salida" />
          <datalist id="destinos-salida"><option value="Depósito" /><option value="Banco" /></datalist>
        </label>
        <label className="campo"><span><strong>4. Para qué</strong> (opcional)</span>
          <input value={sNota} onChange={(e) => setSNota(e.target.value)} maxLength={200} />
        </label>
        <button className="principal" disabled={enviando || !sOk}>{enviando ? "Anotando…" : "Anotar salida de caja fuerte"}</button>
      </form>

      <div className="tarjeta">
        <strong>Salidas de la caja fuerte hoy · {nombreSucursal(sucursal)}</strong>
        {salidas.length === 0 ? <p className="aviso">Todavía no hubo salidas hoy.</p> : (
          <table>
            <thead><tr><th>Hora</th><th>Se lo llevó</th><th>A dónde</th><th className="der">Monto</th></tr></thead>
            <tbody>
              {salidas.map((x) => (
                <tr key={x.id}><td>{hora(x.creado)}</td><td><strong>{x.retiradoPor}</strong></td><td>{x.destino ?? "—"}</td><td className="der">{pesos(x.monto)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

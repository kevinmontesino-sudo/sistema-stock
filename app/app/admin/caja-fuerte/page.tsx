"use client";
import { useEffect, useState } from "react";
import { cajaFuerteDatos, contarCajaFuerteAccion, retirarDeCajaFuerte } from "@/app/admin/acciones";
import { empresa } from "@/lib/empresa.config";
import { fmtMonto, nombreSucursal, pesos } from "@/lib/util";

// Caja fuerte de la empresa: cuanta plata tendria que haber (lo que mandan los cierres de caja menos lo que se retiro) y quien se llevo cada retiro.
type Datos = { resumen: { sucursal: string; entradas: number; guardado: number; ajustes: number; retirado: number; saldo: number }[]; conteos: { id: number; sucursal: string; creado: string; monto: number; contado: number; motivo: string | null; registradoPor: string }[]; movimientos: { id: number; sucursal: string; creado: string; monto: number; origen: "caja" | "caja_fuerte"; destino: string | null; retiradoPor: string; motivo: string | null; registradoPor: string }[] };
const fecha = (iso: string) => new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" });

export default function CajaFuerte() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [filtro, setFiltro] = useState("");
  const [suc, setSuc] = useState(empresa.sucursales[0].id);
  const [monto, setMonto] = useState("");
  const [destino, setDestino] = useState("Depósito");
  const [quien, setQuien] = useState("");
  const [motivo, setMotivo] = useState("");
  const [msg, setMsg] = useState<{ texto: string; mala: boolean } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [version, setVersion] = useState(0);
  const [cSuc, setCSuc] = useState(empresa.sucursales[0].id);
  const [cMonto, setCMonto] = useState("");
  const [cMotivo, setCMotivo] = useState("");

  useEffect(() => {
    let vivo = true;
    cajaFuerteDatos(filtro).then((r) => {
      if (!vivo) return;
      if (r.ok) setDatos({ resumen: r.resumen, movimientos: r.movimientos, conteos: r.conteos });
      else setMsg({ texto: r.motivo, mala: true });
    });
    return () => { vivo = false; };
  }, [filtro, version]);

  const n = Number(monto.replace(/[.\s$]/g, "").replace(",", "."));
  const montoOk = Number.isInteger(n) && n > 0;
  const saldoSuc = datos?.resumen.find((x) => x.sucursal === suc)?.saldo ?? 0;

  async function retirar(e: React.FormEvent) {
    e.preventDefault();
    if (!montoOk) return setMsg({ texto: "Poné el monto en números (ej. 7400000).", mala: true });
    if (quien.trim().length < 2) return setMsg({ texto: "Poné quién se lleva la plata.", mala: true });
    if (!window.confirm(`¿Confirmás que ${quien.trim()} se lleva ${pesos(n)} de la caja fuerte de ${nombreSucursal(suc)}${destino.trim() ? ` (va a ${destino.trim()})` : ""}? No se puede borrar después.`)) return;
    setGuardando(true);
    const r = await retirarDeCajaFuerte(suc, "caja_fuerte", n, quien, destino, motivo);
    setGuardando(false);
    if (!r.ok) return setMsg({ texto: r.motivo, mala: true });
    setMsg({ texto: `Anotado: ${quien.trim()} retiró ${pesos(n)} de la caja fuerte de ${nombreSucursal(suc)}.`, mala: false });
    setMonto(""); setQuien(""); setMotivo("");
    setVersion((v) => v + 1);
  }

  const cN = Number(cMonto.replace(/\./g, ""));
  const cOk = cMonto.trim() !== "" && Number.isInteger(cN) && cN >= 0;
  const cSaldo = datos?.resumen.find((x) => x.sucursal === cSuc)?.saldo ?? 0;
  async function contar(e: React.FormEvent) {
    e.preventDefault();
    if (!cOk) return setMsg({ texto: "Poné lo que contaste en números (ej. 5000000).", mala: true });
    if (!window.confirm(`¿Confirmás que en la caja fuerte de ${nombreSucursal(cSuc)} contaste ${pesos(cN)}? El sistema decía ${pesos(cSaldo)} (diferencia ${pesos(cN - cSaldo)}). No se puede borrar después.`)) return;
    setGuardando(true);
    const r = await contarCajaFuerteAccion(cSuc, cN, cMotivo);
    setGuardando(false);
    if (!r.ok) return setMsg({ texto: r.motivo, mala: true });
    setMsg({ texto: r.diferencia === 0 ? "Coincide: no había diferencia." : `Anotado el conteo de ${nombreSucursal(cSuc)}: ahora tendría que haber ${pesos(cN)}.`, mala: false });
    setCMonto(""); setCMotivo("");
    setVersion((v) => v + 1);
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div>
        <h1>Caja fuerte</h1>
        <p className="aviso" style={{ marginTop: -8 }}>Entra lo que cada cierre de caja manda a la caja fuerte (desde el 16/11) y lo que se va guardando en el día con los cierres parciales; sale lo que se anota como retiro de la caja fuerte. El saldo es lo que <strong>tendría que haber</strong>, no un conteo.</p>
      </div>
      {msg && <p className={msg.mala ? "error" : "aviso"} role="alert">{msg.texto}</p>}

      <div className="tarjeta">
        <strong>Cuánto tendría que haber</strong>
        <table>
          <thead><tr><th>Sucursal</th><th className="der">Entró (cierres)</th><th className="der">Cierres parciales</th><th className="der">Conteos</th><th className="der">Se retiró</th><th className="der">Tendría que haber</th></tr></thead>
          <tbody>
            {datos?.resumen.map((x) => (
              <tr key={x.sucursal}><td>{nombreSucursal(x.sucursal)}</td><td className="der">{pesos(x.entradas)}</td><td className="der">{x.guardado ? `+${pesos(x.guardado)}` : "—"}</td><td className="der">{x.ajustes ? `${x.ajustes > 0 ? "+" : "−"}${pesos(Math.abs(x.ajustes))}` : "—"}</td><td className="der">{x.retirado ? `−${pesos(x.retirado)}` : "—"}</td>
                <td className="der"><strong className={x.saldo < 0 ? "error" : "monto-verde"} style={{ fontSize: 16 }}>{pesos(x.saldo)}</strong></td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <form className="tarjeta" onSubmit={retirar} style={{ display: "grid", gap: 10, maxWidth: 520 }}>
        <strong>Anotar un retiro de la caja fuerte</strong>
        <label className="campo"><span><strong>1. De qué sucursal sale</strong></span>
          <select value={suc} onChange={(e) => setSuc(e.target.value)}>{empresa.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select>
        </label>
        <label className="campo"><span><strong>2. Cuánta plata se lleva</strong></span>
          <input inputMode="numeric" value={monto} onChange={(e) => setMonto(fmtMonto(e.target.value))} placeholder="ej. 7400000" style={{ fontSize: 22 }} />
          {montoOk && <small className="aviso">{pesos(n)}{n > saldoSuc ? " — es más de lo que tendría que haber" : ""}</small>}
        </label>
        <label className="campo"><span><strong>3. Quién se la lleva</strong> (el responsable)</span>
          <input value={quien} onChange={(e) => setQuien(e.target.value)} placeholder="ej. Hugo" maxLength={80} />
        </label>
        <label className="campo"><span><strong>4. A dónde va</strong></span>
          <input value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="ej. Depósito, banco" maxLength={60} list="destinos" />
          <datalist id="destinos"><option value="Depósito" /><option value="Banco" /></datalist>
        </label>
        <label className="campo"><span><strong>5. Para qué</strong> (opcional)</span>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="ej. depósito en el banco" maxLength={200} />
        </label>
        <button className="principal" disabled={guardando || !montoOk || quien.trim().length < 2}>{guardando ? "Anotando…" : "Anotar retiro"}</button>
      </form>

      <form className="tarjeta" onSubmit={contar} style={{ display: "grid", gap: 10, maxWidth: 520 }}>
        <strong>Contar la caja fuerte (para arrancar de cero o corregir)</strong>
        <p className="aviso" style={{ margin: 0 }}>Contás la plata que hay de verdad y el sistema se ajusta a ese número. Queda anotado quién y cuándo.</p>
        <label className="campo"><span><strong>Sucursal</strong></span>
          <select value={cSuc} onChange={(e) => setCSuc(e.target.value)}>{empresa.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select>
        </label>
        <label className="campo"><span><strong>Cuánta plata contaste</strong> (el sistema dice {pesos(cSaldo)})</span>
          <input inputMode="numeric" value={cMonto} onChange={(e) => setCMonto(fmtMonto(e.target.value))} placeholder="ej. 5000000" style={{ fontSize: 22 }} />
        </label>
        <label className="campo"><span>Motivo (opcional)</span><input value={cMotivo} onChange={(e) => setCMotivo(e.target.value)} placeholder="ej. arranque del control" maxLength={200} /></label>
        <button className="principal" disabled={guardando || !cOk}>{guardando ? "Anotando…" : "Anotar conteo"}</button>
      </form>

      <div className="tarjeta">
        <div className="fila" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <strong>Retiros anotados</strong>
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)}><option value="">Todas las sucursales</option>{empresa.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select>
        </div>
        {datos && datos.movimientos.length === 0 ? <p className="aviso">Todavía no hay retiros anotados.</p> : (
          <table>
            <thead><tr><th>Cuándo</th><th>Sucursal</th><th>Sale de</th><th>Se lo llevó</th><th>A dónde</th><th className="der">Monto</th><th>Para qué</th><th>Lo anotó</th></tr></thead>
            <tbody>
              {datos?.movimientos.map((m) => (
                <tr key={m.id}><td>{fecha(m.creado)}</td><td>{nombreSucursal(m.sucursal)}</td><td>{m.origen === "caja" ? (m.destino === "Caja fuerte" ? "Cierre parcial → caja fuerte" : "Caja (parcial viejo)") : "Retiro de caja fuerte"}</td><td><strong>{m.retiradoPor}</strong></td><td>{m.destino ?? "—"}</td><td className="der">{pesos(m.monto)}</td><td>{m.motivo ?? "—"}</td><td>{m.registradoPor}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {datos && datos.conteos.length > 0 && (
        <div className="tarjeta">
          <strong>Conteos anotados</strong>
          <table>
            <thead><tr><th>Cuándo</th><th>Sucursal</th><th className="der">Contado</th><th className="der">Diferencia</th><th>Motivo</th><th>Lo anotó</th></tr></thead>
            <tbody>{datos.conteos.map((c) => <tr key={c.id}><td>{fecha(c.creado)}</td><td>{nombreSucursal(c.sucursal)}</td><td className="der">{pesos(c.contado)}</td><td className="der">{c.monto > 0 ? "+" : "−"}{pesos(Math.abs(c.monto))}</td><td>{c.motivo ?? "—"}</td><td>{c.registradoPor}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

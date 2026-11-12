"use client";
import { useEffect, useState } from "react";
import { controlDelDia } from "@/app/actions";
import type { Control } from "@/lib/cierre";
import { nombreSucursal, pesos } from "@/lib/util";

const dos = (n: number) => String(n).padStart(2, "0");
const hoyLocal = () => { const d = new Date(); return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`; };
const fechaLarga = (dia: string) => { const [a, m, d] = dia.split("-"); return `${d}/${m}/${a}`; };
const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
const dif = (n: number) => (n === 0 ? "OK" : n > 0 ? `Sobra ${pesos(n)}` : `Falta ${pesos(-n)}`);

export default function ControlPage() {
  const [dia, setDia] = useState(hoyLocal);
  const [c, setC] = useState<Control | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    controlDelDia(dia).then((r) => {
      if (!vivo) return;
      if (!r.ok) { setError(r.motivo); return; }
      setError("");
      setC(r.control);
    });
    return () => { vivo = false; };
  }, [dia]);

  function imprimirA4() {
    const estilo = document.createElement("style");
    estilo.textContent = "@page { size: A4; margin: 10mm; }";
    document.head.appendChild(estilo);
    const quitar = () => { estilo.remove(); window.removeEventListener("afterprint", quitar); };
    window.addEventListener("afterprint", quitar);
    window.print();
  }

  // Todos los medios que aparecieron ese dia, para armar las columnas.
  const medios = c ? [...new Map(c.locales.flatMap((l) => l.medios).map((m) => [m.id, m.nombre])).entries()] : [];
  return (
    <>
      <h1>Control diario</h1>
      <p className="aviso no-print" style={{ marginTop: -8 }}>Un resumen del día de todos los locales para imprimir en A4: ventas, cierres de caja, diferencias y cosas para mirar. César también lo puede pedir con su Claude (informe «control»).</p>
      <div className="fila no-print" style={{ margin: "8px 0 12px" }}>
        <label className="fila" style={{ gap: 6 }}>Día <input type="date" value={dia} max={hoyLocal()} onChange={(e) => e.target.value && setDia(e.target.value)} /></label>
        <button className="principal" onClick={imprimirA4} disabled={!c}>Imprimir en A4</button>
      </div>
      <p className="error no-print" role="alert">{error}</p>
      {!c ? <p className="aviso no-print">Cargando…</p> : (
        <div className="solo-impresion hoja-a4">
          <h1>X Menos Más Prendas · Informe de control</h1>
          <div>Día <strong>{fechaLarga(c.dia)}</strong> · generado {new Date(c.generado).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}</div>

          <h2>Para mirar</h2>
          {c.alertas.length === 0 ? <div className="alertas">Sin novedades: todos los locales con ventas cerraron la caja sin diferencias.</div> : (
            <div className="alertas"><ul style={{ margin: 0, paddingLeft: 18 }}>{c.alertas.map((a, i) => <li key={i}>{a}</li>)}</ul></div>
          )}

          <h2>Ventas y cierre de caja</h2>
          <table>
            <thead><tr><th>Local</th><th className="der">Ventas</th><th className="der">Prendas</th><th className="der">Cobrado</th><th>Cierre</th><th className="der">Efectivo debía</th><th className="der">Contado</th><th>Diferencia</th></tr></thead>
            <tbody>
              {c.locales.map((l) => (
                <tr key={l.sucursal}>
                  <td>{nombreSucursal(l.sucursal)}</td><td className="der">{l.ventas}</td><td className="der">{l.unidades}</td><td className="der">{pesos(l.totalCobrado)}</td>
                  <td>{l.cierre ? `${l.cierre.cerradoPor} ${hora(l.cierre.creado)}` : l.ventas > 0 ? <span className="mal">NO CERRÓ</span> : "—"}</td>
                  <td className="der">{l.cierre ? pesos(l.cierre.efectivoEsperado) : "—"}</td><td className="der">{l.cierre ? pesos(l.cierre.efectivoContado) : "—"}</td>
                  <td className={l.cierre && l.cierre.diferencia !== 0 ? "mal" : ""}>{l.cierre ? dif(l.cierre.diferencia) : "—"}</td>
                </tr>
              ))}
              <tr><td><strong>Total</strong></td><td className="der"><strong>{c.total.ventas}</strong></td><td className="der"><strong>{c.total.unidades}</strong></td><td className="der"><strong>{pesos(c.total.cobrado)}</strong></td><td colSpan={3} /><td><strong>{dif(c.total.diferenciaEfectivo)}</strong></td></tr>
            </tbody>
          </table>

          {medios.length > 0 && (
            <>
              <h2>Cobrado por medio de pago</h2>
              <table>
                <thead><tr><th>Medio</th>{c.locales.map((l) => <th key={l.sucursal} className="der">{nombreSucursal(l.sucursal)}</th>)}<th className="der">Total</th></tr></thead>
                <tbody>
                  {medios.map(([id, nombre]) => {
                    const vals = c.locales.map((l) => l.medios.find((m) => m.id === id)?.monto ?? 0);
                    return <tr key={id}><td>{nombre}</td>{vals.map((v, i) => <td key={i} className="der">{v ? pesos(v) : "—"}</td>)}<td className="der"><strong>{pesos(vals.reduce((s, v) => s + v, 0))}</strong></td></tr>;
                  })}
                </tbody>
              </table>
            </>
          )}

          <h2>Notas de crédito y promos</h2>
          <table>
            <thead><tr><th>Local</th><th className="der">Notas emitidas</th><th className="der">Monto</th><th className="der">Pagado con notas</th><th className="der">Ventas con promo</th><th className="der">Descontado por promos</th></tr></thead>
            <tbody>{c.locales.map((l) => <tr key={l.sucursal}><td>{nombreSucursal(l.sucursal)}</td><td className="der">{l.notasEmitidas}</td><td className="der">{pesos(l.notasMonto)}</td><td className="der">{pesos(l.pagadoConNotas)}</td><td className="der">{l.ventasConPromo}</td><td className="der">{pesos(l.ahorroPromos)}</td></tr>)}</tbody>
          </table>

          {c.descuentosEspeciales.length > 0 && (
            <>
              <h2>Descuentos especiales hechos en caja</h2>
              <table>
                <thead><tr><th>Local</th><th>Ticket</th><th>Hora</th><th className="der">%</th><th className="der">Descuento</th><th>Motivo</th><th>Autorizó</th><th>Cajero</th></tr></thead>
                <tbody>{c.descuentosEspeciales.map((e) => <tr key={e.ticket}><td>{nombreSucursal(e.sucursal)}</td><td>{e.ticket}</td><td>{hora(e.hora)}</td><td className="der">{e.pct}%</td><td className="der">{pesos(e.descuento)}</td><td>{e.motivo}</td><td>{e.autorizo}</td><td>{e.cajero}</td></tr>)}</tbody>
              </table>
            </>
          )}

          {c.ventasAnuladas.length > 0 && (
            <>
              <h2>Ventas anuladas</h2>
              <table>
                <thead><tr><th>Local</th><th>Ticket</th><th>Anulada</th><th className="der">Total</th><th>Motivo</th><th>Quién</th></tr></thead>
                <tbody>{c.ventasAnuladas.map((a) => <tr key={a.ticket}><td>{nombreSucursal(a.sucursal)}</td><td>{a.ticket}</td><td>{hora(a.hora)}</td><td className="der">{pesos(a.total)}</td><td>{a.motivo}</td><td>{a.usuario ?? ""}</td></tr>)}</tbody>
              </table>
            </>
          )}

          {c.ajustesDeStock.length > 0 && (
            <>
              <h2>Ajustes de stock</h2>
              <table>
                <thead><tr><th>Hora</th><th>Prenda</th><th>Local</th><th className="der">Unid.</th><th>Motivo</th><th>Quién</th></tr></thead>
                <tbody>{c.ajustesDeStock.map((a, i) => <tr key={i}><td>{hora(a.hora)}</td><td>{a.sku} {a.prenda}</td><td>{a.sucursal ? nombreSucursal(a.sucursal) : ""}</td><td className="der">{a.cantidad}</td><td>{a.motivo}</td><td>{a.usuario}</td></tr>)}</tbody>
              </table>
            </>
          )}

          {c.enviosEnCamino.length > 0 && (
            <>
              <h2>Envíos en camino sin recibir (a hoy)</h2>
              <table>
                <thead><tr><th>Destino</th><th className="der">Envíos</th><th className="der">Prendas</th><th className="der">El más viejo (días)</th></tr></thead>
                <tbody>{c.enviosEnCamino.map((e) => <tr key={e.destino}><td>{nombreSucursal(e.destino)}</td><td className="der">{e.envios}</td><td className="der">{e.unidades}</td><td className="der">{e.diasElMasViejo}</td></tr>)}</tbody>
              </table>
            </>
          )}

          <div className="firmas"><div>Revisó</div><div>Fecha</div><div>Observaciones</div></div>
        </div>
      )}
    </>
  );
}

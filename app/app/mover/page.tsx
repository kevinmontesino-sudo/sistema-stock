"use client";
import { useEffect, useState } from "react";
import { buscarProductos, moverStock } from "@/app/actions";
import { empresa } from "@/lib/empresa.config";
import { useDebounced, usePorcentajesReparto, useSucursal } from "@/lib/hooks";
import { fechaCorta, nombreSucursal, pesos, repartoPorPorcentaje, type Producto } from "@/lib/util";

export default function Mover() {
  const [sucursalActual] = useSucursal();
  const [origen, setOrigen] = useState<string | null>(null);
  const desde = origen ?? sucursalActual;
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [lista, setLista] = useState<Producto[]>([]);
  const [sku, setSku] = useState<string | null>(null);
  const [reparto, setReparto] = useState<Record<string, string>>({});
  const [mensaje, setMensaje] = useState<{ texto: string; mala: boolean } | null>(null);
  const [moviendo, setMoviendo] = useState(false);
  // Reparto automatico: porcentajes por local y prendas marcadas para enviar todas juntas.
  const [pctTxt, setPctTxt] = usePorcentajesReparto();
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [enviando, setEnviando] = useState(false);

  const [version, setVersion] = useState(0);
  const cargar = () => setVersion((v) => v + 1);
  useEffect(() => {
    let vivo = true;
    buscarProductos({ q: dq, sucursalConStock: desde }).then((r) => vivo && r.ok && setLista(r.productos));
    return () => { vivo = false; };
  }, [dq, desde, version]);

  const destinos = empresa.sucursales.filter((s) => s.id !== desde);
  const elegido = lista.find((p) => p.sku === sku);
  const pct = Object.fromEntries(destinos.map((d) => [d.id, Math.max(0, parseInt(pctTxt[d.id] ?? "") || 0)]));
  const sumaPct = Object.values(pct).reduce((s, n) => s + n, 0);
  const pctOk = sumaPct > 0 && sumaPct <= 100;
  const lista_marcadas = lista.filter((p) => marcadas.has(p.sku));
  const aMover = destinos.reduce((s, d) => s + (parseInt(reparto[d.id] ?? "") || 0), 0);

  async function moverYa() {
    if (!elegido || moviendo) return;
    const r: Record<string, number> = {};
    for (const d of destinos) {
      const n = parseInt(reparto[d.id] ?? "") || 0;
      if (n > 0) r[d.id] = n;
    }
    setMoviendo(true);
    const res = await moverStock(elegido.sku, desde, r);
    setMoviendo(false);
    if (!res.ok) return setMensaje({ texto: res.motivo, mala: true });
    setMensaje({
      texto: `${elegido.nombre}: de ${nombreSucursal(desde)} a ${destinos.filter((d) => r[d.id]).map((d) => `${d.nombre} ${r[d.id]}`).join(" · ")}. Quedó en camino: cada local lo ve como pendiente y lo recibe en Ingreso.`,
      mala: false,
    });
    setReparto({});
    cargar();
  }

  async function enviarMarcadas() {
    if (!pctOk || lista_marcadas.length === 0 || enviando) return;
    const total = lista_marcadas.reduce((s, p) => s + Object.values(repartoPorPorcentaje(p.stock[desde] ?? 0, pct)).reduce((a, n) => a + n, 0), 0);
    if (!window.confirm(`Vas a enviar ${total} prendas (${lista_marcadas.length} modelos) desde ${nombreSucursal(desde)} con este reparto: ${destinos.filter((d) => pct[d.id]).map((d) => `${d.nombre} ${pct[d.id]}%`).join(", ")}. Cada local las recibe en Ingreso. ¿Confirmás?`)) return;
    setEnviando(true);
    let ok = 0;
    const fallos: string[] = [];
    for (const p of lista_marcadas) {
      const r = repartoPorPorcentaje(p.stock[desde] ?? 0, pct);
      if (Object.keys(r).length === 0) continue;
      const res = await moverStock(p.sku, desde, r);
      if (res.ok) ok++; else fallos.push(`${p.nombre}: ${res.motivo}`);
    }
    setEnviando(false);
    setMarcadas(new Set());
    setSku(null);
    setMensaje({ texto: `Se enviaron ${ok} modelos.${fallos.length ? ` No se pudieron enviar ${fallos.length}: ${fallos.join(" · ")}` : " Cada local los recibe en Ingreso."}`, mala: fallos.length > 0 });
    cargar();
  }
  const alternar = (k: string) => setMarcadas((m) => { const n = new Set(m); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <>
      <h1>Mover stock entre sucursales</h1>
      <div className="fila" style={{ margin: "0 0 12px" }}>
        <label className="fila" style={{ gap: 8 }}>
          <span>Sale de</span>
          <select value={desde} onChange={(e) => { setOrigen(e.target.value); setSku(null); setReparto({}); setMensaje(null); }}>
            {empresa.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </label>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus
          placeholder="Buscar prenda (SKU o nombre)" style={{ flex: 1, minWidth: 200 }} />
      </div>
      {mensaje && <p className={`alerta ${mensaje.mala ? "mala" : ""}`} role="alert">{mensaje.texto}</p>}

      <div className="tarjeta" style={{ marginBottom: 12 }}>
        <p style={{ margin: "0 0 8px" }}><strong>Reparto automático</strong> <span className="aviso">· marcá prendas en la lista y se reparten solas según estos porcentajes</span></p>
        <div className="fila" style={{ gap: 12, flexWrap: "wrap" }}>
          {destinos.map((d) => (
            <label key={d.id} className="fila" style={{ gap: 6 }}>
              <span>{d.nombre}</span>
              <input type="number" inputMode="numeric" min={0} max={100} value={pctTxt[d.id] ?? ""} placeholder="0" style={{ width: 70 }}
                onChange={(e) => setPctTxt({ ...pctTxt, [d.id]: e.target.value })} />
              <span>%</span>
            </label>
          ))}
          <span className={sumaPct > 100 ? "sin-stock" : "aviso"}>Suma {sumaPct}%{sumaPct > 0 && sumaPct < 100 ? ` · el ${100 - sumaPct}% queda en ${nombreSucursal(desde)}` : ""}</span>
        </div>
        <div className="fila" style={{ gap: 8, marginTop: 8 }}>
          <button className="chico" onClick={() => setMarcadas(new Set(lista.map((p) => p.sku)))} disabled={lista.length === 0}>Marcar todas</button>
          <button className="chico" onClick={() => setMarcadas(new Set())} disabled={marcadas.size === 0}>Desmarcar</button>
          <button className="principal" onClick={enviarMarcadas} disabled={!pctOk || lista_marcadas.length === 0 || enviando}>
            {enviando ? "Enviando…" : !pctOk ? "Poné los porcentajes (suman hasta 100)" : lista_marcadas.length === 0 ? "Marcá las prendas a enviar" : `Enviar ${lista_marcadas.length} prenda${lista_marcadas.length === 1 ? "" : "s"} con este reparto`}
          </button>
        </div>
      </div>

      <div className="grilla">
        <div className="tarjeta" style={{ overflowX: "auto" }}>
          {lista.length === 0 ? (
            <p className="aviso">No hay prendas con stock en {nombreSucursal(desde)}.</p>
          ) : (
            <table>
              <thead><tr><th></th><th>SKU</th><th>Prenda</th><th>Precio</th><th className="der">Stock</th>{pctOk && <th className="der">Mandaría</th>}</tr></thead>
              <tbody>
                {lista.map((p) => (
                  <tr key={p.sku} onClick={() => { setSku(p.sku); setReparto({}); setMensaje(null); }}
                    style={{ cursor: "pointer", background: p.sku === sku ? "var(--acento-fondo)" : undefined }}>
                    <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={marcadas.has(p.sku)} onChange={() => alternar(p.sku)} aria-label={`Marcar ${p.nombre}`} /></td>
                    <td className="mono">{p.sku}</td>
                    <td>{p.nombre} <span className="interno">· ing {fechaCorta(p.ultimoIngreso)}</span></td>
                    <td>{pesos(p.precio)}</td>
                    <td className="der">{p.stock[desde] ?? 0}</td>
                    {pctOk && <td className="der aviso">{(() => { const r = repartoPorPorcentaje(p.stock[desde] ?? 0, pct); return destinos.filter((d) => r[d.id]).map((d) => `${r[d.id]}`).join(" / ") || "—"; })()}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="tarjeta">
          {!elegido ? (
            <p className="aviso">Elegí una prenda de la lista.</p>
          ) : (
            <>
              <p style={{ margin: "0 0 12px" }}>
                <strong>{elegido.nombre}</strong><br />
                <span className="aviso">{elegido.sku} · en {nombreSucursal(desde)}: {elegido.stock[desde] ?? 0}</span>
              </p>
              {pctOk && (
                <button className="chico" style={{ marginBottom: 8 }} onClick={() => {
                  const r = repartoPorPorcentaje(elegido.stock[desde] ?? 0, pct);
                  setReparto(Object.fromEntries(Object.entries(r).map(([k, n]) => [k, String(n)])));
                }}>Usar el reparto automático</button>
              )}
              {destinos.map((d) => (
                <label key={d.id} className="fila" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                  <span>{d.nombre}</span>
                  <input type="number" inputMode="numeric" min={0} value={reparto[d.id] ?? ""} placeholder="0" style={{ width: 90 }}
                    onChange={(e) => setReparto((r) => ({ ...r, [d.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && moverYa()} />
                </label>
              ))}
              <p className="nota">Quedan en {nombreSucursal(desde)}: <strong>{(elegido.stock[desde] ?? 0) - aMover}</strong></p>
              <button className="principal" style={{ width: "100%", marginTop: 8 }} onClick={moverYa} disabled={moviendo}>
                {moviendo ? "Moviendo…" : "Mover"}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

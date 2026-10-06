"use client";
import { useEffect, useState } from "react";
import { buscarProductos, moverStock } from "@/app/actions";
import { empresa } from "@/lib/empresa.config";
import { useDebounced, useSucursal } from "@/lib/hooks";
import { fechaCorta, nombreSucursal, pesos, type Producto } from "@/lib/util";

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

  const [version, setVersion] = useState(0);
  const cargar = () => setVersion((v) => v + 1);
  useEffect(() => {
    let vivo = true;
    buscarProductos({ q: dq, sucursalConStock: desde }).then((r) => vivo && r.ok && setLista(r.productos));
    return () => { vivo = false; };
  }, [dq, desde, version]);

  const destinos = empresa.sucursales.filter((s) => s.id !== desde);
  const elegido = lista.find((p) => p.sku === sku);
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

      <div className="grilla">
        <div className="tarjeta" style={{ overflowX: "auto" }}>
          {lista.length === 0 ? (
            <p className="aviso">No hay prendas con stock en {nombreSucursal(desde)}.</p>
          ) : (
            <table>
              <thead><tr><th>SKU</th><th>Prenda</th><th>Precio</th><th className="der">Stock</th></tr></thead>
              <tbody>
                {lista.map((p) => (
                  <tr key={p.sku} onClick={() => { setSku(p.sku); setReparto({}); setMensaje(null); }}
                    style={{ cursor: "pointer", background: p.sku === sku ? "var(--acento-fondo)" : undefined }}>
                    <td className="mono">{p.sku}</td>
                    <td>{p.nombre} <span className="interno">· ing {fechaCorta(p.ultimoIngreso)}</span></td>
                    <td>{pesos(p.precio)}</td>
                    <td className="der">{p.stock[desde] ?? 0}</td>
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

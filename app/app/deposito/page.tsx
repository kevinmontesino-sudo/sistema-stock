"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { buscarProductos, devolverEnvio, obtenerPendientes, resumenDeSucursal } from "@/app/actions";
import { DEPOSITO } from "@/lib/empresa.config";
import { useDebounced } from "@/lib/hooks";
import { fechaCorta, nombreSucursal, pesos, type Producto, type Traslado } from "@/lib/util";

type Resumen = { prendas: number; modelos: number; valor: number };

export default function Deposito() {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [lista, setLista] = useState<Producto[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [cargando, setCargando] = useState(true);
  const [enCamino, setEnCamino] = useState<Traslado[]>([]);
  const [version, setVersion] = useState(0);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let vivo = true;
    buscarProductos({ q: dq, sucursalConStock: DEPOSITO }).then((r) => {
      if (!vivo) return;
      if (r.ok) setLista(r.productos);
      setCargando(false);
    });
    resumenDeSucursal(DEPOSITO).then((r) => vivo && r.ok && setResumen(r.resumen));
    obtenerPendientes().then((r) => vivo && r.ok && setEnCamino(r.traslados));
    return () => { vivo = false; };
  }, [dq, version]);

  async function devolver(t: Traslado) {
    if (!window.confirm(`¿Cancelar el envío de "${t.nombre}" a ${nombreSucursal(t.hasta)}? Lo que falta recibir vuelve a ${nombreSucursal(t.desde)}.`)) return;
    const r = await devolverEnvio(t.id);
    setMsg(r.ok ? `Se devolvieron ${r.devolucion.devueltas} a ${nombreSucursal(r.devolucion.a)}` : r.motivo);
    setVersion((v) => v + 1);
  }

  return (
    <>
      <h1>{nombreSucursal(DEPOSITO)}: lo que tenemos guardado</h1>
      <div className="fila" style={{ margin: "0 0 12px", gap: 12 }}>
        <div className="tarjeta" style={{ flex: 1, minWidth: 140 }}>
          <div className="rotulo">Prendas</div><div className="total">{resumen ? resumen.prendas.toLocaleString("es-AR") : "…"}</div>
        </div>
        <div className="tarjeta" style={{ flex: 1, minWidth: 140 }}>
          <div className="rotulo">Modelos distintos</div><div className="total">{resumen ? resumen.modelos.toLocaleString("es-AR") : "…"}</div>
        </div>
        <div className="tarjeta" style={{ flex: 1, minWidth: 200 }}>
          <div className="rotulo">Valor a precio de lista</div><div className="total">{resumen ? pesos(resumen.valor) : "…"}</div>
        </div>
      </div>
      <div className="fila" style={{ margin: "0 0 12px" }}>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en el depósito (SKU o nombre)" style={{ flex: 1, minWidth: 200 }} />
        <Link href="/mover" className="boton-link">Enviar a un local</Link>
      </div>
      {enCamino.length > 0 && (
        <>
          <h2>En camino (enviado, todavía sin recibir)</h2>
          {msg && <p className="alerta" role="alert">{msg}</p>}
          <div className="tarjeta" style={{ overflowX: "auto", marginBottom: 16 }}>
            <table>
              <thead><tr><th>Fecha</th><th>Prenda</th><th>De → a</th><th className="der">Recibidas</th><th></th></tr></thead>
              <tbody>
                {enCamino.map((t) => (
                  <tr key={t.id}>
                    <td>{fechaCorta(t.fecha)}</td>
                    <td>{t.nombre} <span className="interno">· {t.sku}</span></td>
                    <td>{nombreSucursal(t.desde)} → {nombreSucursal(t.hasta)}</td>
                    <td className="der"><strong>{t.recibidas}</strong> de {t.cantidad}</td>
                    <td className="der"><button className="chico" onClick={() => devolver(t)}>Cancelar envío</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <h2>En el depósito</h2>
      <div className="tarjeta" style={{ overflowX: "auto" }}>
        {cargando ? <p className="aviso">Cargando…</p> : lista.length === 0 ? (
          <p className="aviso">No hay prendas guardadas en el depósito.</p>
        ) : (
          <table>
            <thead><tr><th>SKU</th><th>Prenda</th><th>Precio de lista</th><th className="der">En depósito</th></tr></thead>
            <tbody>
              {lista.map((p) => (
                <tr key={p.sku}>
                  <td className="mono">{p.sku}</td>
                  <td>{p.nombre} <span className="interno">· ing {fechaCorta(p.ultimoIngreso)}</span></td>
                  <td>{pesos(p.precio)}</td>
                  <td className="der">{p.stock[DEPOSITO] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  deshacerIngresoLocal, devolverEnvio, ingresarProducto, obtenerPendientes, recibirTodoElTraslado, totalSucursal,
} from "@/app/actions";
import { useSucursal, useEscaner } from "@/lib/hooks";
import { fechaCorta, nombreSucursal, type Producto, type Traslado } from "@/lib/util";

type Mensaje = { texto: string; mala: boolean };

export default function IngresoLocal() {
  const [sucursal] = useSucursal();
  const [manual, setManual] = useState("");
  const [lista, setLista] = useState<Producto[]>([]);
  const [pendientes, setPendientes] = useState<Traslado[]>([]);
  const [mensaje, setMensaje] = useState<Mensaje | null>(null);
  const [enLocal, setEnLocal] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const sucursalRef = useRef(sucursal);
  const refrescar = () => setVersion((v) => v + 1);

  useEffect(() => {
    sucursalRef.current = sucursal;
    let vivo = true;
    obtenerPendientes(sucursal).then((r) => vivo && r.ok && setPendientes(r.traslados));
    totalSucursal(sucursal).then((r) => vivo && r.ok && setEnLocal(r.total));
    return () => { vivo = false; };
  }, [sucursal, version]);

  const escanear = useCallback(async (codigo: string) => {
    const c = codigo.trim();
    if (!c) return;
    const suc = sucursalRef.current;
    const r = await ingresarProducto(suc, c);
    if (!r.ok) return setMensaje({ texto: r.motivo, mala: true });
    const { producto, desde } = r.recepcion;
    setLista((l) => [producto, ...l]);
    setMensaje({ texto: `${producto.nombre} · ${producto.sku} · recibida (venía de ${nombreSucursal(desde)})`, mala: false });
    setVersion((v) => v + 1);
  }, []);

  useEscaner(escanear);

  async function deshacer() {
    const u = lista[0];
    if (!u) return;
    const r = await deshacerIngresoLocal(u.sku, sucursal);
    if (!r.ok) return setMensaje({ texto: r.motivo, mala: true });
    setLista((l) => l.slice(1));
    setMensaje({ texto: `Se deshizo la recepción de ${u.nombre}`, mala: false });
    refrescar();
  }

  async function recibirTodo(t: Traslado) {
    const r = await recibirTodoElTraslado(t.id, sucursal);
    if (!r.ok) return setMensaje({ texto: r.motivo, mala: true });
    setMensaje({ texto: `Recibidas ${r.recepcion.recibidas} de ${t.nombre}`, mala: false });
    refrescar();
  }

  async function devolver(t: Traslado) {
    if (!window.confirm(`¿Devolver a ${nombreSucursal(t.desde)} lo que falta recibir de "${t.nombre}"?`)) return;
    const r = await devolverEnvio(t.id);
    if (!r.ok) return setMensaje({ texto: r.motivo, mala: true });
    setMensaje({ texto: `Se devolvieron ${r.devolucion.devueltas} de ${t.nombre} a ${nombreSucursal(r.devolucion.a)}`, mala: false });
    refrescar();
  }

  const resumen = new Map<string, { nombre: string; n: number; ultimoIngreso: string }>();
  for (const x of lista) {
    const r = resumen.get(x.sku) ?? { nombre: x.nombre, n: 0, ultimoIngreso: x.ultimoIngreso };
    r.n++;
    resumen.set(x.sku, r);
  }

  return (
    <>
      <h1>Ingreso · {nombreSucursal(sucursal)}</h1>
      <p className="aviso" style={{ marginTop: -8 }}>Acá se reciben los envíos. Escaneá cada prenda que llega o tocá «Recibir todo».</p>

      <h2>Te enviaron (pendiente de recibir)</h2>
      <div className="tarjeta" style={{ overflowX: "auto" }}>
        {pendientes.length === 0 ? (
          <p className="aviso">No hay envíos pendientes para este local.</p>
        ) : (
          <table>
            <thead><tr><th>Fecha</th><th>Prenda</th><th>Viene de</th><th className="der">Recibidas</th><th></th></tr></thead>
            <tbody>
              {pendientes.map((t) => (
                <tr key={t.id}>
                  <td>{fechaCorta(t.fecha)}</td>
                  <td>{t.nombre} <span className="interno">· {t.sku}</span></td>
                  <td>{nombreSucursal(t.desde)}</td>
                  <td className="der"><strong>{t.recibidas}</strong> de {t.cantidad}</td>
                  <td className="der" style={{ whiteSpace: "nowrap" }}>
                    <button className="chico" onClick={() => recibirTodo(t)}>Recibir todo</button>{" "}
                    <button className="chico" onClick={() => devolver(t)}>Devolver</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <form className="fila" style={{ margin: "16px 0 12px" }}
        onSubmit={(e) => { e.preventDefault(); escanear(manual); setManual(""); }}>
        <input type="text" value={manual} onChange={(e) => setManual(e.target.value)}
          placeholder="Escaneá cada prenda (o escribí el SKU)" style={{ flex: 1, minWidth: 200 }} />
        <button type="submit">Agregar</button>
      </form>
      {mensaje && <p className={`alerta ${mensaje.mala ? "mala" : ""}`} role="alert">{mensaje.texto}</p>}

      <div className="tarjeta">
        <div className="fila" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <span><strong>{lista.length}</strong> prendas recibidas escaneando en esta sesión</span>
          <span className="aviso">Total en {nombreSucursal(sucursal)}: {enLocal ?? "…"}</span>
          <button className="chico" onClick={deshacer} disabled={lista.length === 0}>Deshacer última</button>
        </div>
        {lista.length === 0 ? (
          <p className="aviso">Todavía no se escaneó ninguna prenda.</p>
        ) : (
          <table>
            <thead><tr><th>SKU</th><th>Prenda</th><th className="der">Cantidad</th></tr></thead>
            <tbody>
              {[...resumen.entries()].map(([sku, r]) => (
                <tr key={sku}>
                  <td className="mono">{sku}</td>
                  <td>{r.nombre} <span className="interno">· ing {fechaCorta(r.ultimoIngreso)}</span></td>
                  <td className="der">{r.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

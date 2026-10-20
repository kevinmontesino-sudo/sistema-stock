"use client";
import { useEffect, useState } from "react";
import { usePuede } from "@/components/SesionContext";
import { ajustarStockProducto, buscarProductos, editarProducto, eliminarProducto, ingresosProducto, obtenerMediosPago, reimprimirEtiqueta } from "@/app/actions";
import { Etiqueta } from "@/components/Etiqueta";
import { empresa } from "@/lib/empresa.config";
import { useDebounced } from "@/lib/hooks";
import { fechaCorta, nombreSucursal, pesos, precioMedio, preciosDe, type MedioPago, type Producto } from "@/lib/util";

type Panel = "editar" | "ajustar" | "ingresos" | "etiqueta" | null;

export default function Buscar() {
  // Solo comodidad de la pantalla: el servidor vuelve a verificar el permiso en cada accion.
  const puedeEditar = usePuede("editar_producto");
  const puedeAjustar = usePuede("ajustar_stock");
  const puedeEliminar = usePuede("eliminar_producto");
  const puedeEtiquetar = usePuede("imprimir_etiquetas");
  const [cantEtiq, setCantEtiq] = useState("1");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [lista, setLista] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [sku, setSku] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [nombre, setNombre] = useState("");
  const [precio, setPrecio] = useState("");
  const [cant, setCant] = useState<Record<string, string>>({});
  const [motivo, setMotivo] = useState("");
  const [mensaje, setMensaje] = useState<{ texto: string; mala: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [medios, setMedios] = useState<MedioPago[]>([]);
  const [ingresos, setIngresos] = useState<{ fecha: string; cantidad: number }[]>([]);

  const [version, setVersion] = useState(0);
  const cargar = () => setVersion((v) => v + 1);
  useEffect(() => {
    let vivo = true;
    buscarProductos({ q: dq }).then((r) => {
      if (!vivo) return;
      if (r.ok) setLista(r.productos);
      setCargando(false);
    });
    return () => { vivo = false; };
  }, [dq, version]);

  useEffect(() => {
    let vivo = true;
    obtenerMediosPago().then((r) => vivo && r.ok && setMedios(r.medios));
    return () => { vivo = false; };
  }, []);
  const efectivo = medios.find((m) => m.id === "efectivo");
  const elegido = lista.find((p) => p.sku === sku);

  async function verIngresos(p: Producto) {
    abrir(p, "ingresos");
    const r = await ingresosProducto(p.sku);
    if (r.ok) setIngresos(r.ingresos);
  }

  async function imprimirEtiqueta() {
    if (!elegido || ocupado) return;
    setOcupado(true);
    setMensaje(null);
    const r = await reimprimirEtiqueta(elegido.sku, parseInt(cantEtiq) || 0);
    setOcupado(false);
    if (!r.ok) return setMensaje({ texto: r.motivo, mala: true });
    setMensaje({ texto: `${r.enviadas} etiqueta${r.enviadas === 1 ? "" : "s"} de ${elegido.nombre} enviada${r.enviadas === 1 ? "" : "s"} a la impresora. El stock no cambió.`, mala: false });
    setPanel(null);
  }

  function abrir(p: Producto, que: Panel) {
    setSku(p.sku);
    setPanel(que);
    setCantEtiq("1");
    setNombre(p.nombre);
    setPrecio(String(p.precio));
    setCant(Object.fromEntries(empresa.sucursales.map((s) => [s.id, String(p.stock[s.id] ?? 0)])));
    setMotivo("");
    setMensaje(null);
  }

  async function guardarEdicion() {
    if (!elegido || ocupado) return;
    setOcupado(true);
    const r = await editarProducto(elegido.sku, { nombre, precio: parseInt(precio) || 0 });
    setOcupado(false);
    if (!r.ok) return setMensaje({ texto: r.motivo, mala: true });
    setMensaje({ texto: `Guardado: ${r.producto.nombre} · ${pesos(r.producto.precio)}`, mala: false });
    setPanel(null);
    cargar();
  }

  async function guardarAjuste() {
    if (!elegido || ocupado) return;
    const cambios = empresa.sucursales.filter((s) => (parseInt(cant[s.id] ?? "") || 0) !== (elegido.stock[s.id] ?? 0));
    if (cambios.length === 0) return setMensaje({ texto: "No cambiaste ninguna cantidad", mala: true });
    if (!motivo.trim()) return setMensaje({ texto: "Indicá el motivo del ajuste", mala: true });
    setOcupado(true);
    for (const s of cambios) {
      const r = await ajustarStockProducto(elegido.sku, s.id, parseInt(cant[s.id]) || 0, motivo);
      if (!r.ok) {
        setOcupado(false);
        return setMensaje({ texto: `${s.nombre}: ${r.motivo}`, mala: true });
      }
    }
    setOcupado(false);
    setMensaje({ texto: `Stock ajustado: ${elegido.nombre}`, mala: false });
    setPanel(null);
    cargar();
  }

  async function borrar(p: Producto) {
    const total = Object.values(p.stock).reduce((s, n) => s + n, 0);
    const ok = window.confirm(
      `¿Eliminar "${p.nombre}" (${p.sku})?\n\n` +
      (total ? `Tiene ${total} prendas en stock: se van a dar de baja. ` : "") +
      "Deja de aparecer en búsquedas y ventas, pero las ventas anteriores se conservan.",
    );
    if (!ok) return;
    const r = await eliminarProducto(p.sku);
    if (!r.ok) return setMensaje({ texto: r.motivo, mala: true });
    setMensaje({ texto: `Eliminado: ${p.nombre}`, mala: false });
    setSku(null);
    setPanel(null);
    cargar();
  }

  return (
    <>
      <h1>Buscar prenda</h1>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus
        placeholder="SKU o nombre (ej: remera oversize)" style={{ width: "100%", marginBottom: 12 }} />
      {mensaje && <p className={`alerta ${mensaje.mala ? "mala" : ""}`} role="alert">{mensaje.texto}</p>}

      <div className="tarjeta" style={{ overflowX: "auto" }}>
        {cargando ? (
          <p className="aviso">Cargando…</p>
        ) : lista.length === 0 ? (
          <p className="aviso">No hay productos para mostrar.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th></th><th>SKU</th><th>Prenda</th><th>Transferencia</th>{efectivo && <th>Efectivo</th>}
                {empresa.sucursales.map((s) => <th key={s.id} className="der">{s.nombre}</th>)}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => (
                <tr key={p.sku} style={{ background: p.sku === sku ? "var(--acento-fondo)" : undefined }}>
                  <td>{p.foto && <img src={p.foto} alt="" className="miniatura" />}</td>
                  <td className="mono">{p.sku}</td>
                  <td>{p.nombre} <span className="interno">· ing {fechaCorta(p.ultimoIngreso)}</span></td>
                  <td>{pesos(p.precio)}</td>
                  {efectivo && <td>{pesos(precioMedio(p.precio, efectivo.ajustePct))}</td>}
                  {empresa.sucursales.map((s) => (
                    <td key={s.id} className="der">
                      {p.stock[s.id] ?? 0}
                      {p.enCamino[s.id] ? <div className="interno">+{p.enCamino[s.id]} en camino</div> : null}
                    </td>
                  ))}
                  <td className="der" style={{ minWidth: 150 }}>
                    {puedeEtiquetar && <button className="chico" onClick={() => abrir(p, "etiqueta")}>🏷️ Etiqueta</button>}{" "}
                    <button className="chico" onClick={() => verIngresos(p)}>Ingresos</button>{" "}
                    {puedeEditar && <button className="chico" onClick={() => abrir(p, "editar")}>Editar</button>}{" "}
                    {puedeAjustar && <button className="chico" onClick={() => abrir(p, "ajustar")}>Ajustar stock</button>}{" "}
                    {puedeEliminar && <button className="chico" onClick={() => borrar(p)}>Eliminar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {elegido && panel === "etiqueta" && (
        <div className="tarjeta" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Imprimir etiqueta de {elegido.nombre} ({elegido.sku})</h2>
          <p className="aviso">Para una etiqueta perdida o que salió mal. <strong>No suma ni resta stock.</strong> Sale con el precio actual.</p>
          <Etiqueta sku={elegido.sku} nombre={elegido.nombre} precios={preciosDe(elegido.precio, medios)} />
          <label className="fila" style={{ gap: 8, margin: "12px 0" }}>
            <span>Cantidad de etiquetas</span>
            <input type="number" inputMode="numeric" min={1} max={100} value={cantEtiq} style={{ width: 90 }}
              onChange={(e) => setCantEtiq(e.target.value)} onKeyDown={(e) => e.key === "Enter" && imprimirEtiqueta()} autoFocus />
          </label>
          <div className="fila">
            <button className="principal" onClick={imprimirEtiqueta} disabled={ocupado}>{ocupado ? "Imprimiendo…" : "Imprimir"}</button>
            <button onClick={() => setPanel(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {elegido && panel === "ingresos" && (
        <div className="tarjeta" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Ingresos de {elegido.nombre} ({elegido.sku})</h2>
          {ingresos.length === 0 ? <p className="aviso">Sin ingresos registrados.</p> : (
            <table>
              <thead><tr><th>Fecha</th><th className="der">Cantidad</th></tr></thead>
              <tbody>
                {ingresos.map((i, n) => (
                  <tr key={n}><td>{new Date(i.fecha).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}</td><td className="der">{i.cantidad}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          <button style={{ marginTop: 8 }} onClick={() => setPanel(null)}>Cerrar</button>
        </div>
      )}

      {elegido && panel === "editar" && (
        <div className="tarjeta" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Editar {elegido.sku}</h2>
          <div className="campo"><span>Nombre</span><input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
          <div className="campo"><span>Precio de lista</span>
            <input type="number" inputMode="numeric" value={precio} onChange={(e) => setPrecio(e.target.value)} style={{ width: 160 }} />
          </div>
          <p className="aviso">Las ventas anteriores conservan el nombre y el precio que tenían.</p>
          <div className="fila">
            <button className="principal" onClick={guardarEdicion} disabled={ocupado}>Guardar</button>
            <button onClick={() => setPanel(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {elegido && panel === "ajustar" && (
        <div className="tarjeta" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Ajustar stock de {elegido.nombre} ({elegido.sku})</h2>
          <p className="aviso">Poné la cantidad que hay realmente en cada sucursal. Queda registrado como ajuste, con el motivo.</p>
          {empresa.sucursales.map((s) => (
            <label key={s.id} className="fila" style={{ justifyContent: "space-between", marginBottom: 8, maxWidth: 320 }}>
              <span>{nombreSucursal(s.id)}</span>
              <input type="number" inputMode="numeric" min={0} value={cant[s.id] ?? "0"} style={{ width: 100 }}
                onChange={(e) => setCant((c) => ({ ...c, [s.id]: e.target.value }))} />
            </label>
          ))}
          <div className="campo"><span>Motivo (obligatorio)</span>
            <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="conteo, merma, error de carga…" />
          </div>
          <div className="fila">
            <button className="principal" onClick={guardarAjuste} disabled={ocupado}>Guardar ajuste</button>
            <button onClick={() => setPanel(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </>
  );
}

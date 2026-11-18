"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { buscarProductos, comprarComoEmpleado, datosCompraEmpleado, obtenerMediosPago, obtenerProducto, reintentarFicha } from "@/app/actions";
import { useDebounced, useEscaner, useSucursal } from "@/lib/hooks";
import { nombreSucursal, pesos, precioDeMedio, type MedioPago, type Producto } from "@/lib/util";

type Datos = Extract<Awaited<ReturnType<typeof datosCompraEmpleado>>, { ok: true }>;
type Linea = { producto: Producto; cant: number };

export default function CompraEmpleado() {
  const [sucursal] = useSucursal();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [efectivo, setEfectivo] = useState<MedioPago | null>(null);
  const [empleadoId, setEmpleadoId] = useState("");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [resultados, setResultados] = useState<Producto[]>([]);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [msg, setMsg] = useState<{ texto: string; mala: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [version, setVersion] = useState(0);
  const recargar = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let vivo = true;
    datosCompraEmpleado().then((r) => { if (!vivo) return; if (r.ok) setDatos(r); else setMsg({ texto: r.motivo, mala: true }); });
    return () => { vivo = false; };
  }, [version]);
  useEffect(() => {
    obtenerMediosPago().then((r) => { if (r.ok) setEfectivo(r.medios.find((m) => m.id === "efectivo") ?? null); });
  }, []);
  useEffect(() => {
    let vivo = true;
    if (dq.trim().length < 2) return;
    buscarProductos({ q: dq, sucursalConStock: sucursal }).then((r) => { if (vivo && r.ok) setResultados(r.productos.slice(0, 8)); });
    return () => { vivo = false; };
  }, [dq, sucursal]);
  // Con menos de 2 letras no se muestra nada (aunque quede la busqueda anterior guardada).
  const visibles = q.trim().length < 2 ? [] : resultados;

  const agregar = useCallback((p: Producto) => {
    setLineas((ls) => ls.some((l) => l.producto.sku === p.sku) ? ls.map((l) => l.producto.sku === p.sku ? { ...l, cant: l.cant + 1 } : l) : [...ls, { producto: p, cant: 1 }]);
    setQ(""); setResultados([]); setMsg(null);
  }, []);
  useEscaner((codigo) => {
    obtenerProducto(codigo).then((r) => (r.ok ? agregar(r.producto) : setMsg({ texto: r.motivo, mala: true })));
  });

  const unitario = (p: Producto) => (efectivo ? precioDeMedio({ precio: p.precio, preciosMedio: p.preciosMedio }, efectivo) : p.precio);
  const total = useMemo(() => lineas.reduce((s, l) => s + unitario(l.producto) * l.cant, 0), [lineas, efectivo]); // eslint-disable-line react-hooks/exhaustive-deps
  const emp = datos?.empleados.find((e) => String(e.id) === empleadoId);
  const porLocal = useMemo(() => {
    const m = new Map<string, NonNullable<typeof datos>["empleados"]>();
    for (const e of datos?.empleados ?? []) m.set(e.sucursal, [...(m.get(e.sucursal) ?? []), e]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [datos]);

  async function cargar() {
    if (!emp || lineas.length === 0 || ocupado) return;
    const unidades = lineas.reduce((s, l) => s + l.cant, 0);
    if (!window.confirm(`¿Cargar ${unidades} ${unidades === 1 ? "prenda" : "prendas"} (${pesos(total)}) a la cuenta de ${emp.nombre}?\n\nBajan del stock de ${nombreSucursal(sucursal)} y no se pueden deshacer desde acá.`)) return;
    setOcupado(true);
    const r = await comprarComoEmpleado(sucursal, emp.id, lineas.map((l) => ({ sku: l.producto.sku, cant: l.cant })));
    setOcupado(false);
    if (!r.ok) return setMsg({ texto: r.motivo, mala: true });
    setMsg({
      texto: `Listo: ${r.compra.unidades} ${r.compra.unidades === 1 ? "prenda" : "prendas"} para ${r.compra.empleado}, ${pesos(r.compra.total)} (código ${r.compra.codigo}). ${r.pendientes > 0 ? "La ficha no respondió: queda pendiente y se reenvía sola." : "Cargado en su cuenta."}`,
      mala: false,
    });
    setLineas([]); setEmpleadoId("");
    recargar();
  }

  async function reintentar() {
    setOcupado(true);
    const r = await reintentarFicha();
    setOcupado(false);
    setMsg(r.ok ? { texto: r.pendientes === 0 && r.conError === 0 ? `Se enviaron ${r.enviados} a la ficha.` : `Se enviaron ${r.enviados}. Faltan ${r.pendientes} y ${r.conError} con error.`, mala: r.pendientes + r.conError > 0 } : { texto: r.motivo, mala: true });
    recargar();
  }

  const faltan = (datos?.pendientes.pendiente ?? 0) + (datos?.pendientes.error ?? 0);
  return (
    <>
      <h1>Compra de empleado · {nombreSucursal(sucursal)}</h1>
      <p className="aviso" style={{ marginTop: -8 }}>
        Las prendas bajan del stock y se cargan a la cuenta corriente del empleado en la ficha, a precio Curva Plus (lista −25%, pago en efectivo).
      </p>
      {msg && <p className={`alerta ${msg.mala ? "mala" : ""}`} role="alert">{msg.texto}</p>}
      {datos && !datos.configurada && <p className="alerta mala">Todavía no está conectada la ficha. Un administrador tiene que configurarla (FICHA_URL y FICHA_API_KEY).</p>}
      {datos?.aviso && <p className="alerta mala">{datos.aviso}</p>}
      {faltan > 0 && (
        <p className="alerta">
          Hay {datos?.pendientes.pendiente ?? 0} cargas esperando a la ficha{(datos?.pendientes.error ?? 0) > 0 ? ` y ${datos?.pendientes.error} rechazadas (avisar a la oficina)` : ""}.{" "}
          <button className="chico" onClick={reintentar} disabled={ocupado}>Reintentar ahora</button>
        </p>
      )}

      <div className="tarjeta" style={{ display: "grid", gap: 12, maxWidth: 640, marginBottom: 16 }}>
        <label className="campo"><span><strong>1. ¿Quién se lleva las prendas?</strong></span>
          <select value={empleadoId} onChange={(e) => setEmpleadoId(e.target.value)}>
            <option value="">Elegí al empleado…</option>
            {porLocal.map(([local, lista]) => (
              <optgroup key={local} label={local}>{lista.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}</optgroup>
            ))}
          </select>
        </label>
        <label className="campo"><span><strong>2. Escaneá las prendas</strong> (o buscalas por nombre)</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Escaneá el código o escribí el nombre" />
        </label>
        {visibles.length > 0 && (
          <div style={{ display: "grid", gap: 4 }}>
            {visibles.map((p) => (
              <button key={p.sku} type="button" className="chico" style={{ textAlign: "left" }} onClick={() => agregar(p)}>
                {p.nombre} <span className="mono interno">{p.sku}</span> · hay {Math.max(0, p.stock[sucursal] ?? 0)} · {pesos(unitario(p))}
              </button>
            ))}
          </div>
        )}
      </div>

      {lineas.length > 0 && (
        <div className="tarjeta" style={{ maxWidth: 640, marginBottom: 16 }}>
          <table>
            <thead><tr><th>Prenda</th><th className="der">Cant.</th><th className="der">Efectivo c/u</th><th className="der">Subtotal</th><th></th></tr></thead>
            <tbody>
              {lineas.map((l) => (
                <tr key={l.producto.sku}>
                  <td>{l.producto.nombre} <span className="mono interno">{l.producto.sku}</span></td>
                  <td className="der" style={{ whiteSpace: "nowrap" }}>
                    <button className="chico" onClick={() => setLineas((ls) => ls.map((x) => x.producto.sku === l.producto.sku ? { ...x, cant: Math.max(1, x.cant - 1) } : x))} aria-label="Una menos">−</button>{" "}
                    <strong>{l.cant}</strong>{" "}
                    <button className="chico" onClick={() => setLineas((ls) => ls.map((x) => x.producto.sku === l.producto.sku ? { ...x, cant: x.cant + 1 } : x))} aria-label="Una más">+</button>
                  </td>
                  <td className="der">{pesos(unitario(l.producto))}</td>
                  <td className="der">{pesos(unitario(l.producto) * l.cant)}</td>
                  <td className="der"><button className="chico" onClick={() => setLineas((ls) => ls.filter((x) => x.producto.sku !== l.producto.sku))}>Quitar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 20, margin: "12px 0 8px" }}><strong>Total a su cuenta: {pesos(total)}</strong></p>
          <button className="principal" onClick={cargar} disabled={ocupado || !emp || !datos?.configurada}>
            {ocupado ? "Cargando…" : emp ? `Cargar a la cuenta de ${emp.nombre}` : "Elegí al empleado"}
          </button>
        </div>
      )}

      {datos && datos.ultimas.length > 0 && (
        <>
          <h2>Últimas compras de empleados</h2>
          <div className="tarjeta" style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th>Fecha</th><th>Empleado</th><th className="der">Prendas</th><th className="der">Monto</th><th>Estado</th></tr></thead>
              <tbody>
                {datos.ultimas.map((c) => (
                  <tr key={c.codigo}>
                    <td style={{ whiteSpace: "nowrap" }}>{new Date(c.creado).toLocaleString("es-AR", { hour12: false, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                    <td>{c.empleado}</td><td className="der">{c.prendas}</td><td className="der">{pesos(c.monto)}</td>
                    <td>{c.pendientes === 0 ? "En su cuenta" : "Pendiente en la ficha"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

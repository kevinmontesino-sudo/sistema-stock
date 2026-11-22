"use client";
import { useEffect, useState } from "react";
import { actualizarVendedor, cargarVendedores, importarVendedoresDeFicha, listarVendedoresAdmin } from "@/app/admin/acciones";
import { empresa } from "@/lib/empresa.config";
import type { Vendedor } from "@/lib/repo";
import { nombreSucursal } from "@/lib/util";

// Personas que pueden figurar como "vendedor" en la caja. Cada una pertenece a UNA sucursal (ahi compite por la comision),
// pero en la caja de cualquier sucursal se puede elegir a cualquiera.
export default function Vendedores() {
  const [lista, setLista] = useState<Vendedor[]>([]);
  const [msg, setMsg] = useState<{ texto: string; mala: boolean } | null>(null);
  const [suc, setSuc] = useState(empresa.sucursales[0].id);
  const [nombres, setNombres] = useState("");
  const [editando, setEditando] = useState<number | null>(null);
  const [edit, setEdit] = useState({ nombre: "", sucursalId: "", activo: true });
  const [version, setVersion] = useState(0);
  const recargar = () => setVersion((v) => v + 1);

  useEffect(() => {
    let vivo = true;
    listarVendedoresAdmin().then((r) => {
      if (!vivo) return;
      if (r.ok) setLista(r.vendedores);
      else setMsg({ texto: r.motivo, mala: true });
    });
    return () => { vivo = false; };
  }, [version]);

  async function cargar(e: React.FormEvent) {
    e.preventDefault();
    const r = await cargarVendedores(suc, nombres);
    if (!r.ok) return setMsg({ texto: r.motivo, mala: true });
    setMsg({ texto: `Listo: ${r.nuevos} ${r.nuevos === 1 ? "persona nueva" : "personas nuevas"} en ${nombreSucursal(suc)}${r.total > r.nuevos ? ` (${r.total - r.nuevos} ya estaban)` : ""}.`, mala: false });
    setNombres("");
    recargar();
  }
  const [trayendo, setTrayendo] = useState(false);
  async function traerDeFicha() {
    setTrayendo(true);
    const r = await importarVendedoresDeFicha();
    setTrayendo(false);
    if (!r.ok) return setMsg({ texto: r.motivo, mala: true });
    setMsg({ texto: `Ficha: ${r.total} empleados activos. ${r.nuevos} nuevos, ${r.actualizados} ya estaban.${r.sinSucursal.length ? ` No se pudieron ubicar en una sucursal: ${r.sinSucursal.join(", ")}.` : ""}`, mala: r.sinSucursal.length > 0 });
    recargar();
  }
  async function guardar(id: number) {
    const r = await actualizarVendedor(id, edit);
    if (!r.ok) return setMsg({ texto: r.motivo, mala: true });
    setEditando(null);
    setMsg({ texto: "Guardado.", mala: false });
    recargar();
  }

  return (
    <main className="contenedor">
      <h1>Vendedores y comisiones</h1>
      <p className="aviso">Las personas que aparecen en la caja como «¿Quién vendió?». Cada una pertenece a una sucursal (ahí compite por su comisión), pero se puede elegir en la caja de cualquier sucursal. Elegir vendedor es opcional: si el cliente se atiende solo, la venta queda sin vendedor y no suma comisión a nadie.</p>
      {msg && <p className={msg.mala ? "error" : "ok"} role="status">{msg.texto}</p>}

      <div className="tarjeta" style={{ marginBottom: 16, display: "grid", gap: 6 }}>
        <strong>Traer de la ficha</strong>
        <span className="aviso">Carga a todos los empleados activos con la sucursal que tienen en la ficha. Se puede repetir cuando entre alguien nuevo o cambie de sucursal: no duplica ni reactiva a quien diste de baja acá.</span>
        <button className="principal" onClick={traerDeFicha} disabled={trayendo}>{trayendo ? "Trayendo…" : "Traer empleados de la ficha"}</button>
      </div>

      <form onSubmit={cargar} className="tarjeta" style={{ display: "grid", gap: 8, marginBottom: 16 }}>
        <strong>Agregar personas</strong>
        <select value={suc} onChange={(e) => setSuc(e.target.value)}>
          {empresa.sucursales.map((s) => <option key={s.id} value={s.id}>Pertenecen a: {s.nombre}</option>)}
        </select>
        <textarea rows={4} value={nombres} onChange={(e) => setNombres(e.target.value)} placeholder={"Un nombre por línea\nEj.\nCandela\nSantiago"} />
        <button className="principal" disabled={nombres.trim().length < 2}>Agregar</button>
      </form>

      {empresa.sucursales.map((s) => {
        const de = lista.filter((v) => v.sucursalId === s.id);
        return (
          <section key={s.id} className="tarjeta" style={{ marginBottom: 12, borderLeft: `4px solid ${s.color}` }}>
            <strong>{s.nombre}</strong> <span className="aviso">· {de.filter((v) => v.activo).length} {de.filter((v) => v.activo).length === 1 ? "activa" : "activas"}</span>
            {de.length === 0 && <p className="aviso" style={{ margin: "6px 0 0" }}>Nadie cargado.</p>}
            {de.map((v) => (
              <div key={v.id} className="fila" style={{ gap: 8, padding: "6px 0", opacity: v.activo ? 1 : 0.55, alignItems: "center" }}>
                {editando === v.id ? (<>
                  <input value={edit.nombre} maxLength={80} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} />
                  <select value={edit.sucursalId} onChange={(e) => setEdit({ ...edit, sucursalId: e.target.value })}>
                    {empresa.sucursales.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                  </select>
                  <label className="fila" style={{ gap: 4 }}><input type="checkbox" checked={edit.activo} onChange={(e) => setEdit({ ...edit, activo: e.target.checked })} /> Activa</label>
                  <button className="principal chico" onClick={() => guardar(v.id)}>Guardar</button>
                  <button className="chico" onClick={() => setEditando(null)}>Cancelar</button>
                </>) : (<>
                  <span style={{ flex: 1 }}>{v.nombre}{!v.activo && " (inactiva)"}</span>
                  <button className="chico" onClick={() => { setEditando(v.id); setEdit({ nombre: v.nombre, sucursalId: v.sucursalId, activo: v.activo }); }}>Editar</button>
                </>)}
              </div>
            ))}
          </section>
        );
      })}
    </main>
  );
}

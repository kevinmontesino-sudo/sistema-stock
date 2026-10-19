"use client";
import { useEffect, useState } from "react";
import { listarAuditoria, type FilaAuditoria } from "@/app/admin/acciones";
import { useDebounced } from "@/lib/hooks";

const fechaHora = (iso: string) => new Date(iso).toLocaleString("es-AR", { hour12: false });

export default function Auditoria() {
  const [filas, setFilas] = useState<FilaAuditoria[]>([]);
  const [acciones, setAcciones] = useState<string[]>([]);
  const [accion, setAccion] = useState("");
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 300);
  const [pagina, setPagina] = useState(0);
  const [error, setError] = useState("");
  const [cargado, setCargado] = useState(false);
  const [abierta, setAbierta] = useState<number | null>(null);

  useEffect(() => {
    let vivo = true;
    listarAuditoria({ accion, q: dq, pagina }).then((r) => {
      if (!vivo) return;
      if (r.ok) { setFilas(r.filas); setAcciones(r.acciones); setError(""); } else setError(r.motivo);
      setCargado(true);
    });
    return () => { vivo = false; };
  }, [accion, dq, pagina]);

  return (
    <>
      <h1>Auditoría</h1>
      <p className="aviso" style={{ marginTop: -8 }}>Registro de lo que hace cada persona. Solo se agrega: nadie puede modificarlo ni borrarlo.</p>
      <div className="fila" style={{ marginBottom: 12 }}>
        <select value={accion} onChange={(e) => { setAccion(e.target.value); setPagina(0); }}>
          <option value="">Todas las acciones</option>
          {acciones.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <input type="search" placeholder="Buscar por usuario o dato" value={q} onChange={(e) => { setQ(e.target.value); setPagina(0); }} style={{ flex: 1, minWidth: 200 }} />
      </div>
      {error && <p className="error">{error}</p>}
      <div className="tarjeta" style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>IP</th><th></th></tr></thead>
          <tbody>
            {filas.map((f) => (
              <>
                <tr key={f.id}>
                  <td>{fechaHora(f.fecha)}</td><td>{f.usuario ?? "—"}</td><td className="mono">{f.accion}</td><td>{f.ip ?? "—"}</td>
                  <td className="der"><button className="chico" onClick={() => setAbierta(abierta === f.id ? null : f.id)}>{abierta === f.id ? "Ocultar" : "Detalle"}</button></td>
                </tr>
                {abierta === f.id && <tr key={`${f.id}d`}><td colSpan={5}><pre className="mono" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{JSON.stringify(f.detalle, null, 2)}</pre></td></tr>}
              </>
            ))}
            {filas.length === 0 && <tr><td colSpan={5} className="aviso">{cargado ? "No hay registros con ese filtro." : "Cargando…"}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="fila" style={{ marginTop: 12 }}>
        <button className="chico" onClick={() => setPagina((p) => Math.max(0, p - 1))} disabled={pagina === 0}>← Más nuevos</button>
        <span className="aviso">Página {pagina + 1}</span>
        <button className="chico" onClick={() => setPagina((p) => p + 1)} disabled={filas.length < 100}>Más viejos →</button>
      </div>
    </>
  );
}

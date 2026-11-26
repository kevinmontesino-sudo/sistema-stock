"use client";
import { useEffect, useState } from "react";
import { cambiarAlcanceToken, conexionesConector, crearTokenApi, listarTokens, revocarConexionConector, revocarToken, type TokenFila } from "@/app/admin/acciones";

const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-AR", { hour12: false }) : "nunca");

export default function Accesos() {
  const [lista, setLista] = useState<TokenFila[]>([]);
  const [msg, setMsg] = useState<{ texto: string; mala: boolean } | null>(null);
  const [nuevo, setNuevo] = useState<{ token: string; nombre: string; vence: string; alcance: string } | null>(null);
  const [form, setForm] = useState({ nombre: "", dias: 90, alcance: "informes" });
  const [version, setVersion] = useState(0);
  const [origen, setOrigen] = useState("");
  useEffect(() => { setOrigen(window.location.origin); }, []);
  const [conexiones, setConexiones] = useState<{ id: number; cliente: string; usuario: string; creado: string; ultimoUso: string | null; usos: number; revocado: string | null; motivo: string | null }[]>([]);

  useEffect(() => {
    let vivo = true;
    listarTokens().then((r) => { if (!vivo) return; if (r.ok) setLista(r.tokens); else setMsg({ texto: r.motivo, mala: true }); });
    conexionesConector().then((r) => { if (vivo && r.ok) setConexiones(r.conexiones); });
    return () => { vivo = false; };
  }, [version]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    const r = await crearTokenApi(form);
    if (!r.ok) return setMsg({ texto: r.motivo, mala: true });
    setNuevo({ token: r.token, nombre: r.nombre, vence: r.vence, alcance: form.alcance });
    setForm({ nombre: "", dias: 90, alcance: "informes" }); setMsg(null); setVersion((v) => v + 1);
  }
  async function alcance(t: TokenFila) {
    const nuevo = t.alcance === "promos" ? "informes" : "promos";
    const texto = nuevo === "promos"
      ? `¿Darle a "${t.nombre}" permiso para crear y desactivar promos? La llave sigue siendo la misma: no hay que cambiar nada donde está configurada.`
      : `¿Sacarle a "${t.nombre}" el permiso de promos? Va a quedar solo para leer informes.`;
    if (!window.confirm(texto)) return;
    const r = await cambiarAlcanceToken(t.id, nuevo);
    setMsg(r.ok ? { texto: "Permiso actualizado.", mala: false } : { texto: r.motivo, mala: true });
    setVersion((v) => v + 1);
  }
  async function cortar(c: { id: number; cliente: string; usuario: string }) {
    if (!window.confirm(`¿Cortar la conexión de ${c.cliente} de ${c.usuario}? Deja de funcionar en el momento (para volver, hay que conectar de nuevo desde Claude).`)) return;
    const r = await revocarConexionConector(c.id);
    setMsg(r.ok ? { texto: "Conexión cortada.", mala: false } : { texto: r.motivo, mala: true });
    setVersion((v) => v + 1);
  }
  async function revocar(t: TokenFila) {
    if (!window.confirm(`¿Revocar la llave "${t.nombre}"? Deja de funcionar en el momento.`)) return;
    const r = await revocarToken(t.id);
    setMsg(r.ok ? { texto: "Llave revocada.", mala: false } : { texto: r.motivo, mala: true });
    setVersion((v) => v + 1);
  }

  return (
    <>
      <h1>Accesos a la API</h1>
      <p className="aviso" style={{ marginTop: -8 }}>
        Una llave permite consultar los informes (solo totales: sin datos personales ni contraseñas) desde otra herramienta, por ejemplo el Claude de César. Las llaves de alcance &quot;promos&quot; además pueden crear y desactivar promos.
        Cada llave vence (salvo que elijas «sin vencimiento»), se puede revocar en cualquier momento y cada consulta queda en la Auditoría.
      </p>
      {msg && <p className={`alerta ${msg.mala ? "mala" : ""}`} role="alert">{msg.texto}</p>}
      {nuevo && (
        <div className="tarjeta" style={{ marginBottom: 16, borderColor: "var(--acento)" }}>
          <p style={{ margin: 0 }}><strong>Llave &quot;{nuevo.nombre}&quot;</strong> (vence el {fecha(nuevo.vence)})</p>
          <p className="mono" style={{ fontSize: 15, margin: "8px 0", wordBreak: "break-all" }}>{nuevo.token}</p>
          <p className="aviso" style={{ margin: 0 }}>Copiala ahora y pasásela solo a quien corresponda: <strong>no se vuelve a mostrar</strong>. {nuevo.alcance === "stock" ? "Quien la tenga solo puede consultar prendas, precios y stock por local: no ve ventas, cajas ni informes y no puede modificar nada." : <>Quien la tenga puede leer los informes{nuevo.alcance === "promos" ? " y crear o desactivar promos" : "; no puede modificar nada"}.</>}</p>
          <div className="fila" style={{ gap: 8, marginTop: 8 }}>
            <button className="chico" onClick={() => navigator.clipboard?.writeText(nuevo.token)}>Copiar</button>
            <button className="chico" onClick={() => setNuevo(null)}>Listo, ya la guardé</button>
          </div>
        </div>
      )}
      <div className="tarjeta" style={{ overflowX: "auto", marginBottom: 16 }}>
        <table>
          <thead><tr><th>Nombre</th><th>Alcance</th><th>Llave</th><th>Vence</th><th>Último uso</th><th className="der">Usos</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {lista.map((t) => (
              <tr key={t.id} style={{ opacity: t.estado === "activa" ? 1 : 0.5 }}>
                <td>{t.nombre}</td><td>{t.alcance === "promos" ? "Informes + promos" : t.alcance === "stock" ? "Solo stock" : "Solo informes"}</td><td className="mono">{t.prefijo}…</td><td>{fecha(t.vence)}</td><td>{fecha(t.ultimoUso)}</td><td className="der">{t.usos}</td><td>{t.estado}</td>
                <td className="der" style={{ whiteSpace: "nowrap" }}>{t.estado === "activa" && <>
                  {t.alcance !== "stock" && <button className="chico" onClick={() => alcance(t)}>{t.alcance === "promos" ? "Quitar promos" : "Permitir promos"}</button>}{" "}
                  <button className="chico" onClick={() => revocar(t)}>Revocar</button>
                </>}</td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={8} className="aviso">Todavía no hay llaves.</td></tr>}
          </tbody>
        </table>
      </div>
      <h2>Conexiones de Claude / ChatGPT (conector con login)</h2>
      <p className="aviso" style={{ marginTop: -8 }}>
        Se agregan desde Claude o ChatGPT como conector personalizado con la dirección <strong className="mono">{origen}/mcp</strong>: piden iniciar sesión con la cuenta de un administrador y tocar «Permitir». Funcionan desde la web, la app y el celular. Solo leen (y administran promos); no mueven plata.
      </p>
      <div className="tarjeta" style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>Aplicación</th><th>Persona</th><th>Conectada</th><th>Último uso</th><th className="der">Usos</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {conexiones.map((c) => (
              <tr key={c.id}>
                <td>{c.cliente}</td><td>{c.usuario}</td><td>{fecha(c.creado)}</td><td>{fecha(c.ultimoUso)}</td><td className="der">{c.usos}</td>
                <td>{c.revocado ? <span className="aviso">Cortada {fecha(c.revocado)}{c.motivo ? ` (${c.motivo})` : ""}</span> : "Activa"}</td>
                <td>{!c.revocado && <button className="chico" onClick={() => cortar(c)}>Cortar</button>}</td>
              </tr>
            ))}
            {conexiones.length === 0 && <tr><td colSpan={7} className="aviso">Todavía nadie conectó Claude con login.</td></tr>}
          </tbody>
        </table>
      </div>
      <h2>Nueva llave</h2>
      <form className="tarjeta" onSubmit={crear} style={{ display: "grid", gap: 10, maxWidth: 520 }}>
        <input placeholder="Nombre (por ejemplo: Cesar - Claude)" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required />
        <select value={form.dias} onChange={(e) => setForm({ ...form, dias: Number(e.target.value) })}>
          <option value={30}>Vence en 30 días</option><option value={90}>Vence en 90 días</option><option value={180}>Vence en 180 días</option><option value={3650}>Sin vencimiento (10 años; se revoca cuando quieras)</option>
        </select>
        <select value={form.alcance} onChange={(e) => setForm({ ...form, alcance: e.target.value })}>
          <option value="informes">Solo leer informes</option><option value="promos">Leer informes y administrar promos</option>
          <option value="stock">Solo stock (para el asistente de clientes)</option>
        </select>
        <button className="principal" type="submit">Crear llave</button>
      </form>
    </>
  );
}

"use client";
import { useEffect, useState } from "react";
import { crearTokenApi, listarTokens, revocarToken, type TokenFila } from "@/app/admin/acciones";

const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-AR", { hour12: false }) : "nunca");

export default function Accesos() {
  const [lista, setLista] = useState<TokenFila[]>([]);
  const [msg, setMsg] = useState<{ texto: string; mala: boolean } | null>(null);
  const [nuevo, setNuevo] = useState<{ token: string; nombre: string; vence: string } | null>(null);
  const [form, setForm] = useState({ nombre: "", dias: 90 });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let vivo = true;
    listarTokens().then((r) => { if (!vivo) return; if (r.ok) setLista(r.tokens); else setMsg({ texto: r.motivo, mala: true }); });
    return () => { vivo = false; };
  }, [version]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    const r = await crearTokenApi(form);
    if (!r.ok) return setMsg({ texto: r.motivo, mala: true });
    setNuevo({ token: r.token, nombre: r.nombre, vence: r.vence });
    setForm({ nombre: "", dias: 90 }); setMsg(null); setVersion((v) => v + 1);
  }
  async function revocar(t: TokenFila) {
    if (!window.confirm(`¿Revocar la llave "${t.nombre}"? Deja de funcionar en el momento.`)) return;
    const r = await revocarToken(t.id);
    setMsg(r.ok ? { texto: "Llave revocada.", mala: false } : { texto: r.motivo, mala: true });
    setVersion((v) => v + 1);
  }

  return (
    <>
      <h1>Accesos a la API de informes</h1>
      <p className="aviso" style={{ marginTop: -8 }}>
        Una llave permite consultar los informes (solo lectura, solo totales: sin datos personales ni contraseñas) desde otra herramienta, por ejemplo el Claude de César.
        Cada llave vence, se puede revocar en cualquier momento y cada consulta queda en la Auditoría.
      </p>
      {msg && <p className={`alerta ${msg.mala ? "mala" : ""}`} role="alert">{msg.texto}</p>}
      {nuevo && (
        <div className="tarjeta" style={{ marginBottom: 16, borderColor: "var(--acento)" }}>
          <p style={{ margin: 0 }}><strong>Llave &quot;{nuevo.nombre}&quot;</strong> (vence el {fecha(nuevo.vence)})</p>
          <p className="mono" style={{ fontSize: 15, margin: "8px 0", wordBreak: "break-all" }}>{nuevo.token}</p>
          <p className="aviso" style={{ margin: 0 }}>Copiala ahora y pasásela solo a quien corresponda: <strong>no se vuelve a mostrar</strong>. Quien la tenga puede leer los informes; no puede modificar nada.</p>
          <div className="fila" style={{ gap: 8, marginTop: 8 }}>
            <button className="chico" onClick={() => navigator.clipboard?.writeText(nuevo.token)}>Copiar</button>
            <button className="chico" onClick={() => setNuevo(null)}>Listo, ya la guardé</button>
          </div>
        </div>
      )}
      <div className="tarjeta" style={{ overflowX: "auto", marginBottom: 16 }}>
        <table>
          <thead><tr><th>Nombre</th><th>Llave</th><th>Vence</th><th>Último uso</th><th className="der">Usos</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {lista.map((t) => (
              <tr key={t.id} style={{ opacity: t.estado === "activa" ? 1 : 0.5 }}>
                <td>{t.nombre}</td><td className="mono">{t.prefijo}…</td><td>{fecha(t.vence)}</td><td>{fecha(t.ultimoUso)}</td><td className="der">{t.usos}</td><td>{t.estado}</td>
                <td className="der">{t.estado === "activa" && <button className="chico" onClick={() => revocar(t)}>Revocar</button>}</td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={7} className="aviso">Todavía no hay llaves.</td></tr>}
          </tbody>
        </table>
      </div>
      <h2>Nueva llave</h2>
      <form className="tarjeta" onSubmit={crear} style={{ display: "grid", gap: 10, maxWidth: 520 }}>
        <input placeholder="Nombre (por ejemplo: Cesar - Claude)" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required />
        <select value={form.dias} onChange={(e) => setForm({ ...form, dias: Number(e.target.value) })}>
          <option value={30}>Vence en 30 días</option><option value={90}>Vence en 90 días</option><option value={180}>Vence en 180 días</option>
        </select>
        <button className="principal" type="submit">Crear llave</button>
      </form>
    </>
  );
}

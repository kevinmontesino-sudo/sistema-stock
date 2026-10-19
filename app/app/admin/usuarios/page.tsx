"use client";
import { useEffect, useState } from "react";
import { actualizarUsuario, crearUsuario, listarUsuarios, restablecerClave, restablecerDobleVerificacion, type UsuarioFila } from "@/app/admin/acciones";
import { empresa } from "@/lib/empresa.config";
import { NOMBRE_ROL, ROLES } from "@/lib/seguridad/permisos";
import { nombreSucursal } from "@/lib/util";

const LOCALES = empresa.sucursales.filter((s) => s.id !== "deposito");
const necesitaLocal = (rol: string) => rol === "vendedor" || rol === "encargado";
const fechaHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-AR", { hour12: false }) : "nunca");

export default function Usuarios() {
  const [lista, setLista] = useState<UsuarioFila[]>([]);
  const [msg, setMsg] = useState<{ texto: string; mala: boolean } | null>(null);
  const [clave, setClave] = useState<{ email: string; clave: string } | null>(null);
  const [nuevo, setNuevo] = useState({ nombre: "", email: "", rol: "vendedor", sucursalId: LOCALES[0].id });
  const [editando, setEditando] = useState<number | null>(null);
  const [edit, setEdit] = useState({ nombre: "", rol: "vendedor", sucursalId: "", activo: true });
  const [version, setVersion] = useState(0);
  const recargar = () => setVersion((v) => v + 1);

  useEffect(() => {
    let vivo = true;
    listarUsuarios().then((r) => {
      if (!vivo) return;
      if (r.ok) setLista(r.usuarios);
      else setMsg({ texto: r.motivo, mala: true });
    });
    return () => { vivo = false; };
  }, [version]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    const r = await crearUsuario(nuevo);
    if (!r.ok) return setMsg({ texto: r.motivo, mala: true });
    setClave({ email: r.email, clave: r.clave });
    setMsg(null);
    setNuevo({ nombre: "", email: "", rol: "vendedor", sucursalId: LOCALES[0].id });
    recargar();
  }
  async function guardar(id: number) {
    const r = await actualizarUsuario(id, edit);
    if (!r.ok) return setMsg({ texto: r.motivo, mala: true });
    setEditando(null);
    setMsg({ texto: "Usuario actualizado.", mala: false });
    recargar();
  }
  async function reiniciarClave(u: UsuarioFila) {
    if (!window.confirm(`¿Generar una contraseña temporal nueva para ${u.nombre}? Se cierran sus sesiones abiertas.`)) return;
    const r = await restablecerClave(u.id);
    if (!r.ok) return setMsg({ texto: r.motivo, mala: true });
    setClave({ email: r.email, clave: r.clave });
  }
  async function reiniciar2fa(u: UsuarioFila) {
    if (!window.confirm(`¿Reiniciar la doble verificación de ${u.nombre}? Va a tener que configurarla de nuevo al entrar.`)) return;
    const r = await restablecerDobleVerificacion(u.id);
    setMsg(r.ok ? { texto: "Doble verificación reiniciada.", mala: false } : { texto: r.motivo, mala: true });
    recargar();
  }

  return (
    <>
      <h1>Usuarios</h1>
      {msg && <p className={`alerta ${msg.mala ? "mala" : ""}`} role="alert">{msg.texto}</p>}
      {clave && (
        <div className="tarjeta" style={{ marginBottom: 16, borderColor: "var(--acento)" }}>
          <p style={{ margin: 0 }}><strong>Contraseña temporal de {clave.email}</strong></p>
          <p className="mono" style={{ fontSize: 22, margin: "8px 0" }}>{clave.clave}</p>
          <p className="aviso" style={{ margin: 0 }}>Anotala ahora y pasásela a la persona: <strong>no se vuelve a mostrar</strong>. Al entrar tiene que elegir una propia.</p>
          <button className="chico" style={{ marginTop: 8 }} onClick={() => setClave(null)}>Listo, ya la anoté</button>
        </div>
      )}
      <div className="tarjeta" style={{ overflowX: "auto", marginBottom: 16 }}>
        <table>
          <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Local</th><th>2FA</th><th>Último ingreso</th><th></th></tr></thead>
          <tbody>
            {lista.map((u) => editando === u.id ? (
              <tr key={u.id}>
                <td><input value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} /></td>
                <td>{u.email}</td>
                <td><select value={edit.rol} onChange={(e) => setEdit({ ...edit, rol: e.target.value, sucursalId: necesitaLocal(e.target.value) ? (edit.sucursalId || LOCALES[0].id) : "" })}>
                  {ROLES.map((r) => <option key={r} value={r}>{NOMBRE_ROL[r]}</option>)}</select></td>
                <td>{necesitaLocal(edit.rol) ? <select value={edit.sucursalId} onChange={(e) => setEdit({ ...edit, sucursalId: e.target.value })}>
                  {LOCALES.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select> : "—"}</td>
                <td colSpan={2}><label><input type="checkbox" checked={edit.activo} onChange={(e) => setEdit({ ...edit, activo: e.target.checked })} /> Activo</label></td>
                <td className="der"><button className="chico" onClick={() => guardar(u.id)}>Guardar</button> <button className="chico" onClick={() => setEditando(null)}>Cancelar</button></td>
              </tr>
            ) : (
              <tr key={u.id} style={{ opacity: u.activo ? 1 : 0.5 }}>
                <td>{u.nombre}{!u.activo && " (inactivo)"}</td>
                <td>{u.email}</td>
                <td>{NOMBRE_ROL[u.rol]}</td>
                <td>{u.sucursalId ? nombreSucursal(u.sucursalId) : "—"}</td>
                <td>{u.totpActivo ? "Sí" : "No"}</td>
                <td>{fechaHora(u.ultimoLogin)}{u.debeCambiarClave && <span className="interno"> · clave temporal</span>}</td>
                <td className="der">
                  <button className="chico" onClick={() => { setEditando(u.id); setEdit({ nombre: u.nombre, rol: u.rol, sucursalId: u.sucursalId ?? "", activo: u.activo }); }}>Editar</button>{" "}
                  <button className="chico" onClick={() => reiniciarClave(u)}>Nueva clave</button>{" "}
                  {u.totpActivo && <button className="chico" onClick={() => reiniciar2fa(u)}>Reiniciar 2FA</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Nuevo usuario</h2>
      <form className="tarjeta" onSubmit={crear} style={{ display: "grid", gap: 10, maxWidth: 520 }}>
        <input placeholder="Nombre y apellido" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} required />
        <input type="email" placeholder="Email (es su usuario)" value={nuevo.email} onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })} required />
        <div className="fila">
          <select value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{NOMBRE_ROL[r]}</option>)}</select>
          {necesitaLocal(nuevo.rol) && (
            <select value={nuevo.sucursalId} onChange={(e) => setNuevo({ ...nuevo, sucursalId: e.target.value })}>{LOCALES.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select>
          )}
        </div>
        <p className="aviso" style={{ margin: 0 }}>Se genera una contraseña temporal que se muestra una sola vez. Los vendedores y encargados trabajan siempre en su local.</p>
        <button className="principal" type="submit">Crear usuario</button>
      </form>
    </>
  );
}

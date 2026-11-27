"use client";
import { useEffect, useMemo, useState } from "react";
import { ajustarCuentaMayorista, cobrarACliente, crearClienteMayorista, datosMayoristas, editarClienteMayorista, estadoCuentaMayorista } from "@/app/actions";
import type { Cliente } from "@/lib/cuentas";
import { fmtMonto, pesos, soloDigitos } from "@/lib/util";

// Clientes mayoristas del Deposito: cada cliente es del vendedor que le vende (Santiago, Mayra, Tomas). Venta por telefono "a cuenta" (se hace desde Vender, eligiendo
// el cliente), cobros (entra plata: baja la deuda y suma comision 0,5% al vendedor dueno) y estado de cuenta. La deuda va en valor de lista (ya con Curva Plus).
type Datos = Awaited<ReturnType<typeof datosMayoristas>>;
type Ok = Extract<Datos, { ok: true }>;
type Cuenta = Extract<Awaited<ReturnType<typeof estadoCuentaMayorista>>, { ok: true }>["cuenta"];
const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" }) : "—");
const TIPO: Record<string, string> = { venta: "Venta a cuenta", pago: "Pago", devolucion: "Devolución", anulacion: "Venta anulada", ajuste: "Ajuste" };

export default function Mayoristas() {
  const [d, setD] = useState<Ok | null>(null);
  const [msg, setMsg] = useState<{ texto: string; mala: boolean } | null>(null);
  const [version, setVersion] = useState(0);
  const [vendedor, setVendedor] = useState<number | "todos">("todos");
  const [abierto, setAbierto] = useState<number | null>(null);
  const [cuenta, setCuenta] = useState<Cuenta | null>(null);
  // nuevo cliente
  const [nuevo, setNuevo] = useState({ nombre: "", telefono: "", vendedorId: 0, limite: "" });
  // cobro
  const [cobro, setCobro] = useState({ medio: "transferencia", monto: "", motivo: "" });
  const [ocupado, setOcupado] = useState(false);
  const [ajuste, setAjuste] = useState({ monto: "", motivo: "" });

  useEffect(() => {
    let vivo = true;
    datosMayoristas().then((r) => { if (!vivo) return; if (r.ok) setD(r); else setMsg({ texto: r.motivo, mala: true }); });
    return () => { vivo = false; };
  }, [version]);
  useEffect(() => {
    if (abierto === null) { setCuenta(null); return; }
    let vivo = true;
    estadoCuentaMayorista(abierto).then((r) => { if (!vivo) return; if (r.ok) setCuenta(r.cuenta); else setMsg({ texto: r.motivo, mala: true }); });
    return () => { vivo = false; };
  }, [abierto, version]);

  const clientes = d?.clientes ?? [];
  const vendedores = d?.vendedores ?? [];
  const visibles = useMemo(() => clientes.filter((c) => c.activo && (vendedor === "todos" || c.vendedorId === vendedor)), [clientes, vendedor]);
  const porVendedor = useMemo(() => {
    const m = new Map<number, { vendedor: string; clientes: Cliente[] }>();
    for (const c of visibles) { const x = m.get(c.vendedorId) ?? { vendedor: c.vendedor, clientes: [] }; x.clientes.push(c); m.set(c.vendedorId, x); }
    return [...m.entries()];
  }, [visibles]);
  const deudaDe = (cs: Cliente[]) => cs.reduce((s, c) => s + c.saldo, 0);
  const num = (s: string) => (s === "" ? NaN : Number(s));

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!nuevo.vendedorId) return setMsg({ texto: "Elegí el vendedor dueño del cliente.", mala: true });
    setOcupado(true);
    const r = await crearClienteMayorista({ nombre: nuevo.nombre, telefono: nuevo.telefono, vendedorId: nuevo.vendedorId, limite: nuevo.limite === "" ? null : Number(nuevo.limite) });
    setOcupado(false);
    if (!r.ok) return setMsg({ texto: r.motivo, mala: true });
    setMsg({ texto: `Cliente «${nuevo.nombre.trim()}» creado.`, mala: false });
    setNuevo({ nombre: "", telefono: "", vendedorId: nuevo.vendedorId, limite: "" });
    setVersion((v) => v + 1);
  }
  async function cobrar(c: Cliente) {
    const n = num(cobro.monto);
    if (!Number.isInteger(n) || n < 1) return setMsg({ texto: "Poné cuánta plata entró, en números.", mala: true });
    if (!window.confirm(`¿Confirmás que ${c.nombre} pagó ${pesos(n)} en ${cobro.medio}? Entra a la caja de hoy del Depósito y baja su deuda. No se puede borrar después.`)) return;
    setOcupado(true);
    const r = await cobrarACliente(c.id, cobro.medio, n, cobro.motivo);
    setOcupado(false);
    if (!r.ok) return setMsg({ texto: r.motivo, mala: true });
    setMsg({ texto: `Pago anotado: ${pesos(n)} de ${c.nombre}. Su deuda queda en ${pesos(r.saldo)} (valor de lista). Comisión para ${c.vendedor}: ${pesos(r.comision)}.`, mala: false });
    setCobro({ ...cobro, monto: "", motivo: "" });
    setVersion((v) => v + 1);
  }
  async function guardarLimite(c: Cliente) {
    const txt = window.prompt(`Límite de deuda de ${c.nombre} (en valor de lista, solo números). Vacío = sin límite.`, c.limite === null ? "" : String(c.limite));
    if (txt === null) return;
    const r = await editarClienteMayorista(c.id, { limite: txt.replace(/\D/g, "") === "" ? null : Number(txt.replace(/\D/g, "")) });
    setMsg(r.ok ? { texto: "Límite actualizado.", mala: false } : { texto: r.motivo, mala: true });
    setVersion((v) => v + 1);
  }
  async function cambiarVendedor(c: Cliente) {
    if (!d?.esAdmin) return;
    const nom = window.prompt(`¿A qué vendedor pasa ${c.nombre}? Escribí el nombre tal como figura:\n${vendedores.map((v) => v.nombre).join(" · ")}`);
    if (!nom) return;
    const v = vendedores.find((x) => x.nombre.toLowerCase() === nom.trim().toLowerCase());
    if (!v) return setMsg({ texto: "No encontré ese vendedor.", mala: true });
    const motivo = window.prompt("Motivo del cambio (5 letras o más):") ?? "";
    const r = await editarClienteMayorista(c.id, { vendedorId: v.id }, motivo);
    setMsg(r.ok ? { texto: `${c.nombre} ahora es cliente de ${v.nombre}.`, mala: false } : { texto: r.motivo, mala: true });
    setVersion((x) => x + 1);
  }
  async function ajustar(c: Cliente) {
    const n = num(ajuste.monto);
    if (!Number.isInteger(n) || n === 0) return setMsg({ texto: "Poné el ajuste en números (positivo suma deuda, negativo la baja).", mala: true });
    if (!window.confirm(`¿Ajustar la cuenta de ${c.nombre} en ${n > 0 ? "+" : "−"}${pesos(Math.abs(n))} (valor de lista)? Queda a tu nombre.`)) return;
    const r = await ajustarCuentaMayorista(c.id, n, ajuste.motivo);
    setMsg(r.ok ? { texto: `Ajuste hecho. Deuda: ${pesos(r.saldo)}.`, mala: false } : { texto: r.motivo, mala: true });
    if (r.ok) setAjuste({ monto: "", motivo: "" });
    setVersion((x) => x + 1);
  }

  const com = d?.comisiones;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div>
        <h1>Clientes mayoristas</h1>
        <p className="aviso" style={{ marginTop: -8 }}>Cuentas de los clientes que compran por teléfono. Cada cliente es del vendedor que le vende. La venta <strong>a cuenta</strong> se hace en <strong>Vender</strong> eligiendo el cliente; acá se ven las deudas, se anotan los <strong>cobros</strong> y se ve la <strong>comisión</strong> ({com?.porcentaje ?? 0.5}% de lo que paga el cliente, para su vendedor). La deuda está en <strong>valor de lista</strong> (ya con Curva Plus): se muestra también en pesos de cada medio.</p>
      </div>
      {msg && <p className={msg.mala ? "error" : "aviso"} role="alert">{msg.texto}</p>}

      <div className="fila" style={{ gap: 6, flexWrap: "wrap" }}>
        <button className={`chico ${vendedor === "todos" ? "on" : ""}`} onClick={() => setVendedor("todos")}>Todos</button>
        {vendedores.filter((v) => clientes.some((c) => c.vendedorId === v.id && c.activo)).map((v) => (
          <button key={v.id} className={`chico ${vendedor === v.id ? "on" : ""}`} onClick={() => setVendedor(v.id)}>Clientes de {v.nombre.split(" ")[0]}</button>
        ))}
      </div>

      {porVendedor.length === 0 && <p className="aviso">Todavía no hay clientes. Creá el primero abajo.</p>}
      {porVendedor.map(([vid, g]) => (
        <div key={vid} className="tarjeta" style={{ overflowX: "auto" }}>
          <strong>Clientes de {g.vendedor}</strong> <span className="aviso">· deben {pesos(deudaDe(g.clientes))} (lista){com?.porVendedor.find((x) => x.vendedorId === vid) ? ` · comisión de ${com.mes}: ${pesos(com.porVendedor.find((x) => x.vendedorId === vid)!.comision)}` : ""}</span>
          <table>
            <thead><tr><th>Cliente</th><th className="der">Debe (lista)</th><th className="der">En transferencia</th><th className="der">En efectivo</th><th className="der">Límite</th><th className="der">Sin pagar</th><th></th></tr></thead>
            <tbody>
              {g.clientes.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.nombre}</strong>{c.telefono ? <small className="aviso"> · {c.telefono}</small> : null}</td>
                  <td className="der"><strong className={c.superaLimite ? "error" : undefined}>{pesos(c.saldo)}</strong></td>
                  <td className="der">{c.saldo ? pesos(c.equivalentes.transferencia) : "—"}</td>
                  <td className="der">{c.saldo ? pesos(c.equivalentes.efectivo) : "—"}</td>
                  <td className="der">{c.limite === null ? "sin límite" : pesos(c.limite)}</td>
                  <td className="der">{c.diasSinPagar === null ? "—" : `${c.diasSinPagar} d`}</td>
                  <td><button className="chico" onClick={() => { setAbierto(abierto === c.id ? null : c.id); setMsg(null); }}>{abierto === c.id ? "Cerrar" : "Ver cuenta / cobrar"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {abierto !== null && cuenta && (
        <div className="tarjeta" style={{ display: "grid", gap: 12 }}>
          <div className="fila" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div>
              <h2 style={{ margin: 0 }}>{cuenta.cliente.nombre}</h2>
              <span className="aviso">Cliente de {cuenta.cliente.vendedor} · Debe {pesos(cuenta.cliente.saldo)} de lista = {pesos(cuenta.cliente.equivalentes.transferencia)} en transferencia o {pesos(cuenta.cliente.equivalentes.efectivo)} en efectivo{cuenta.cliente.limite !== null ? ` · límite ${pesos(cuenta.cliente.limite)}` : ""}</span>
            </div>
            <div className="fila" style={{ gap: 6 }}>
              <button className="chico" onClick={() => guardarLimite(cuenta.cliente)}>Cambiar límite</button>
              {d?.esAdmin && <button className="chico" onClick={() => cambiarVendedor(cuenta.cliente)}>Cambiar de vendedor</button>}
              <button className="chico" onClick={() => window.print()}>Imprimir estado de cuenta</button>
            </div>
          </div>
          {cuenta.cliente.saldo > 0 && (
            <div className="fila no-print" style={{ gap: 8, flexWrap: "wrap", alignItems: "end" }}>
              <label className="campo" style={{ margin: 0 }}><span><strong>Cobrar</strong> (entra plata)</span>
                <select value={cobro.medio} onChange={(e) => setCobro({ ...cobro, medio: e.target.value })}><option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option></select>
              </label>
              <label className="campo" style={{ margin: 0 }}><span>Monto</span>
                <input inputMode="numeric" value={fmtMonto(cobro.monto)} onChange={(e) => setCobro({ ...cobro, monto: soloDigitos(e.target.value) })} placeholder="ej. 500.000" style={{ width: 150 }} />
              </label>
              <label className="campo" style={{ margin: 0, flex: 1, minWidth: 140 }}><span>Nota (opcional)</span>
                <input value={cobro.motivo} onChange={(e) => setCobro({ ...cobro, motivo: e.target.value })} maxLength={200} />
              </label>
              <button className="principal" disabled={ocupado} onClick={() => cobrar(cuenta.cliente)}>Anotar cobro</button>
            </div>
          )}
          <table>
            <thead><tr><th>Fecha</th><th>Movimiento</th><th>Ticket</th><th>Medio</th><th className="der">Pesos</th><th className="der">Deuda (lista)</th><th>Detalle</th></tr></thead>
            <tbody>
              {cuenta.movimientos.map((m) => (
                <tr key={m.id}>
                  <td>{fecha(m.fecha)}</td><td>{TIPO[m.tipo] ?? m.tipo}</td><td>{m.venta ?? "—"}</td><td>{m.medio ?? "—"}</td>
                  <td className="der">{m.monto ? pesos(m.monto) : "—"}</td>
                  <td className="der"><strong className={m.valorLista < 0 ? "monto-verde" : undefined}>{m.valorLista > 0 ? "+" : "−"}{pesos(Math.abs(m.valorLista))}</strong></td>
                  <td><small>{[m.motivo, m.autorizo ? `autorizó ${m.autorizo}` : "", m.comision ? `comisión ${pesos(m.comision)}` : "", `por ${m.registradoPor}`].filter(Boolean).join(" · ")}</small></td>
                </tr>
              ))}
              {cuenta.movimientos.length === 0 && <tr><td colSpan={7} className="aviso">Sin movimientos todavía.</td></tr>}
            </tbody>
          </table>
          {d?.esAdmin && (
            <div className="fila no-print" style={{ gap: 8, flexWrap: "wrap", alignItems: "end" }}>
              <label className="campo" style={{ margin: 0 }}><span>Ajuste de admin (+ suma deuda / − la baja; ej. cargar la deuda de hoy)</span>
                <input value={ajuste.monto} onChange={(e) => setAjuste({ ...ajuste, monto: e.target.value.replace(/[^\d-]/g, "") })} placeholder="ej. 1500000" style={{ width: 170 }} />
              </label>
              <label className="campo" style={{ margin: 0, flex: 1, minWidth: 160 }}><span>Motivo</span>
                <input value={ajuste.motivo} onChange={(e) => setAjuste({ ...ajuste, motivo: e.target.value })} maxLength={200} />
              </label>
              <button className="chico" onClick={() => ajustar(cuenta.cliente)}>Hacer ajuste</button>
            </div>
          )}
        </div>
      )}

      <form className="tarjeta no-print" onSubmit={crear} style={{ display: "grid", gap: 10, maxWidth: 560 }}>
        <strong>Nuevo cliente mayorista</strong>
        <label className="campo"><span><strong>Nombre</strong></span><input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} maxLength={80} required /></label>
        <label className="campo"><span><strong>Vendedor dueño</strong> (el que le vende; comisiona sus cobros)</span>
          <select value={nuevo.vendedorId} onChange={(e) => setNuevo({ ...nuevo, vendedorId: Number(e.target.value) })}>
            <option value={0}>Elegí…</option>{vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
          </select>
        </label>
        <label className="campo"><span>Teléfono (opcional)</span><input value={nuevo.telefono} onChange={(e) => setNuevo({ ...nuevo, telefono: e.target.value })} maxLength={40} /></label>
        <label className="campo"><span>Límite de deuda en valor de lista (opcional; vacío = sin límite)</span>
          <input inputMode="numeric" value={fmtMonto(nuevo.limite)} onChange={(e) => setNuevo({ ...nuevo, limite: soloDigitos(e.target.value) })} placeholder="ej. 2.000.000" />
        </label>
        <button className="principal" disabled={ocupado || nuevo.nombre.trim().length < 2}>Crear cliente</button>
      </form>

      {com && (
        <div className="tarjeta">
          <strong>Comisión de mayoristas · {com.mes} ({com.porcentaje}% de lo cobrado)</strong>
          {com.porVendedor.length === 0 ? <p className="aviso">Todavía no hubo cobros este mes.</p> : (
            <table>
              <thead><tr><th>Vendedor</th><th className="der">Cobrado de sus clientes</th><th className="der">Comisión</th></tr></thead>
              <tbody>
                {com.porVendedor.map((v) => <tr key={v.vendedorId}><td>{v.vendedor}</td><td className="der">{pesos(v.cobrado)}</td><td className="der"><strong>{pesos(v.comision)}</strong></td></tr>)}
                <tr><td><strong>Total</strong></td><td className="der">{pesos(com.totalCobrado)}</td><td className="der"><strong>{pesos(com.totalComision)}</strong></td></tr>
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

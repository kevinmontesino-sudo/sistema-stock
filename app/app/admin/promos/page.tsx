"use client";
import { useEffect, useMemo, useState } from "react";
import { crearPromoAdmin, desactivarPromoAdmin, promosAdmin } from "@/app/admin/acciones";
import { empresa } from "@/lib/empresa.config";
import type { PromoFila } from "@/lib/promosAdmin";
import { descripcionPromo, textoPromo, TOPE_PCT, type TipoPromo } from "@/lib/promos";
import { nombreSucursal, pesos } from "@/lib/util";

type Especial = { codigo: string; fecha: string; sucursal: string; usuario: string | null; pct: number; descuento: number; total: number; motivo: string; autorizo: string };
type Categoria = { codigo: string; nombre: string };

// Plantillas de un toque: cada una pide como mucho un numero. Cubren las promos y ferias que usa el negocio.
const PLANTILLAS: { id: string; titulo: string; ayuda: string; tipo: TipoPromo; n?: number; m?: number; minimo?: boolean }[] = [
  { id: "3x2", titulo: "3x2", ayuda: "Lleva 3, paga 2", tipo: "nxm", n: 3, m: 2 },
  { id: "2x1", titulo: "2x1", ayuda: "Lleva 2, paga 1", tipo: "nxm", n: 2, m: 1 },
  { id: "pct", titulo: "% off", ayuda: "Descuento sobre lista", tipo: "porcentaje" },
  { id: "precio", titulo: "Todo a $X", ayuda: "Feria precio único o categoría a $X c/u", tipo: "precio" },
  { id: "cantidad", titulo: "Llevando N, a $X c/u", ayuda: "Docena mayorista", tipo: "precio", minimo: true },
  { id: "nxm", titulo: "Otro NxM", ayuda: "4x3, 5x4…", tipo: "nxm", n: 4, m: 3 },
];

const LOCALES = empresa.sucursales;
const ar = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
const hoy = () => ar(new Date());
const masDias = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const diaLindo = (iso: string) => { const d = new Date(iso + "T12:00:00Z"); return `${DIAS[d.getUTCDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`; };
function finde() {
  const h = hoy();
  const dow = new Date(h + "T12:00:00Z").getUTCDay();
  if (dow === 0) return { desde: h, hasta: h };
  if (dow === 6) return { desde: h, hasta: masDias(h, 1) };
  return { desde: masDias(h, 6 - dow), hasta: masDias(h, 7 - dow) };
}
const VACIO = { plantilla: "3x2", n: 3, m: 2, pct: 20, precio: 0, nombre: "", sucursales: [] as string[], tipos: [] as string[], desde: "", hasta: "", sinCambio: false, efectivo: true };

export default function Promos() {
  const [promos, setPromos] = useState<PromoFila[]>([]);
  const [especiales, setEspeciales] = useState<Especial[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [msg, setMsg] = useState<{ texto: string; mala: boolean } | null>(null);
  const [form, setForm] = useState(() => ({ ...VACIO, desde: hoy(), hasta: hoy() }));
  const [version, setVersion] = useState(0);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vivo = true;
    promosAdmin().then((r) => {
      if (!vivo) return;
      if (!r.ok) return setMsg({ texto: r.motivo, mala: true });
      setPromos(r.promos); setEspeciales(r.especiales); setCategorias(r.tipos);
    });
    return () => { vivo = false; };
  }, [version]);

  const plantilla = PLANTILLAS.find((p) => p.id === form.plantilla)!;
  const tipo = plantilla.tipo;
  const alternar = (lista: string[], v: string) => (lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]);
  function elegir(id: string) {
    const p = PLANTILLAS.find((x) => x.id === id)!;
    // Por defecto: el efectivo corre encima de NxM y %, pero no en precios de feria o mayorista.
    setForm((f) => ({ ...f, plantilla: id, n: p.n ?? (p.minimo ? 12 : f.n), m: p.m ?? f.m, efectivo: p.tipo !== "precio" }));
  }

  // La promo como quedaria, para la vista previa y para mandarla.
  const datos = {
    tipo,
    n: tipo === "nxm" ? form.n : plantilla.minimo ? form.n : null,
    m: tipo === "nxm" ? form.m : null,
    pct: tipo === "porcentaje" ? form.pct : null,
    precio: tipo === "precio" ? form.precio : null,
  };
  const cats = form.tipos.map((c) => categorias.find((x) => x.codigo === c)?.nombre ?? c);
  const frase = descripcionPromo({ ...datos, categorias: cats, sinCambio: form.sinCambio, descuentoEfectivo: form.efectivo });
  const donde = form.sucursales.length ? form.sucursales.map(nombreSucursal).join(", ") : "todos los locales";
  const cuando = form.desde === form.hasta ? `El ${diaLindo(form.desde)}` : `Del ${diaLindo(form.desde)} al ${diaLindo(form.hasta)}`;
  const listo = tipo !== "precio" || form.precio > 0;

  // Promos activas que se pisan con esta (mismos dias y algun local en comun): no se suman, va la que mas descuenta.
  const choques = useMemo(() => promos.filter((p) => (p.estado === "vigente" || p.estado === "programada")
    && p.desde <= form.hasta && p.hasta >= form.desde
    && (p.sucursales.length === 0 || form.sucursales.length === 0 || p.sucursales.some((s) => form.sucursales.includes(s)))), [promos, form.desde, form.hasta, form.sucursales]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!listo) return setMsg({ texto: "Poné el precio por prenda.", mala: true });
    setOcupado(true);
    const r = await crearPromoAdmin({
      ...datos, nombre: form.nombre, desde: form.desde, hasta: form.hasta, sucursales: form.sucursales, tipos: form.tipos,
      descuento_efectivo: form.efectivo, sin_cambio: form.sinCambio,
    });
    setOcupado(false);
    if (!r.ok) return setMsg({ texto: r.motivo, mala: true });
    setMsg({ texto: `Listo: "${r.promo.nombre}" — ${r.promo.descripcion}.`, mala: false });
    setForm({ ...VACIO, desde: hoy(), hasta: hoy() });
    setVersion((v) => v + 1);
  }

  async function desactivar(p: PromoFila) {
    if (!window.confirm(`¿Desactivar la promo "${p.nombre}"? Deja de aplicarse en las cajas en el momento.`)) return;
    const r = await desactivarPromoAdmin(p.id);
    setMsg(r.ok ? { texto: "Promo desactivada.", mala: false } : { texto: r.motivo, mala: true });
    setVersion((v) => v + 1);
  }

  const ESTADO: Record<PromoFila["estado"], string> = { vigente: "🟢 Activa ahora", programada: "🕒 Programada", terminada: "Terminó", desactivada: "Desactivada" };

  return (
    <>
      <h1>Promos</h1>
      <p className="aviso" style={{ marginTop: -8 }}>
        Se aplican solas en la caja al escanear, en los locales y días que elijas. No se suman: si hay varias, va la que más descuenta.
        En un NxM no se pagan las prendas más baratas. César también las puede cargar desde su Claude.
      </p>
      {msg && <p className={`alerta ${msg.mala ? "mala" : ""}`} role="alert">{msg.texto}</p>}

      <form className="tarjeta" onSubmit={crear} style={{ display: "grid", gap: 14, maxWidth: 760, marginBottom: 24 }}>
        <h2 style={{ margin: 0 }}>1. ¿Qué promo?</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
          {PLANTILLAS.map((p) => (
            <button key={p.id} type="button" className={form.plantilla === p.id ? "principal" : ""} onClick={() => elegir(p.id)} style={{ textAlign: "left", padding: "10px 12px" }}>
              <strong>{p.titulo}</strong><br /><small>{p.ayuda}</small>
            </button>
          ))}
        </div>
        <div className="fila" style={{ gap: 8, flexWrap: "wrap" }}>
          {tipo === "nxm" && form.plantilla === "nxm" && <>
            Lleva <input type="number" min={2} max={10} value={form.n} onChange={(e) => setForm({ ...form, n: Number(e.target.value) })} onWheel={(e) => e.currentTarget.blur()} style={{ width: 70 }} />
            y paga <input type="number" min={1} max={9} value={form.m} onChange={(e) => setForm({ ...form, m: Number(e.target.value) })} onWheel={(e) => e.currentTarget.blur()} style={{ width: 70 }} />
          </>}
          {tipo === "porcentaje" && <>
            <input type="number" min={0.5} max={TOPE_PCT} step={0.5} value={form.pct} onChange={(e) => setForm({ ...form, pct: Number(e.target.value) })} onWheel={(e) => e.currentTarget.blur()} style={{ width: 90 }} />
            % de descuento sobre el precio de lista
          </>}
          {plantilla.minimo && <>
            Llevando <input type="number" min={2} max={100} value={form.n} onChange={(e) => setForm({ ...form, n: Number(e.target.value) })} onWheel={(e) => e.currentTarget.blur()} style={{ width: 80 }} /> o más,
          </>}
          {tipo === "precio" && <>
            cada prenda a $ <input type="number" min={1} step={100} value={form.precio || ""} placeholder="4500" onChange={(e) => setForm({ ...form, precio: Number(e.target.value) })} onWheel={(e) => e.currentTarget.blur()} style={{ width: 120 }} required />
          </>}
        </div>

        <h2 style={{ margin: "6px 0 0" }}>2. ¿Dónde y cuándo?</h2>
        <div className="fila" style={{ gap: 6, flexWrap: "wrap" }}>
          <button type="button" className={`chico ${form.sucursales.length === 0 ? "on" : ""}`} onClick={() => setForm({ ...form, sucursales: [] })}>Todos los locales</button>
          {LOCALES.map((s) => (
            <button key={s.id} type="button" className={`chico ${form.sucursales.includes(s.id) ? "on" : ""}`} onClick={() => setForm({ ...form, sucursales: alternar(form.sucursales, s.id) })}>{s.nombre}</button>
          ))}
        </div>
        <div className="fila" style={{ gap: 6, flexWrap: "wrap" }}>
          <button type="button" className={`chico ${form.tipos.length === 0 ? "on" : ""}`} onClick={() => setForm({ ...form, tipos: [] })}>Todas las prendas</button>
          {categorias.map((c) => (
            <button key={c.codigo} type="button" className={`chico ${form.tipos.includes(c.codigo) ? "on" : ""}`} onClick={() => setForm({ ...form, tipos: alternar(form.tipos, c.codigo) })}>{c.nombre}</button>
          ))}
        </div>
        <div className="fila" style={{ gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="chico" onClick={() => setForm({ ...form, desde: hoy(), hasta: hoy() })}>Hoy</button>
          <button type="button" className="chico" onClick={() => setForm({ ...form, desde: masDias(hoy(), 1), hasta: masDias(hoy(), 1) })}>Mañana</button>
          <button type="button" className="chico" onClick={() => setForm({ ...form, desde: masDias(hoy(), 1), hasta: masDias(hoy(), 2) })}>Mañana y pasado</button>
          <button type="button" className="chico" onClick={() => setForm({ ...form, ...finde() })}>Este finde</button>
          <button type="button" className="chico" onClick={() => setForm({ ...form, desde: hoy(), hasta: masDias(hoy(), 6) })}>7 días</button>
          <label className="fila" style={{ gap: 6 }}>Desde <input type="date" value={form.desde} min={hoy()} onChange={(e) => setForm({ ...form, desde: e.target.value, hasta: form.hasta < e.target.value ? e.target.value : form.hasta })} required /></label>
          <label className="fila" style={{ gap: 6 }}>Hasta <input type="date" value={form.hasta} min={form.desde} onChange={(e) => setForm({ ...form, hasta: e.target.value })} required /></label>
        </div>
        <label className="fila" style={{ gap: 8 }}>
          <input type="checkbox" checked={form.efectivo} onChange={(e) => setForm({ ...form, efectivo: e.target.checked })} />
          <span>Además corre el descuento de efectivo (−20%). <span className="aviso">La tarjeta siempre lleva su recargo.</span></span>
        </label>
        <label className="fila" style={{ gap: 8 }}>
          <input type="checkbox" checked={form.sinCambio} onChange={(e) => setForm({ ...form, sinCambio: e.target.checked })} />
          <span>Sin cambio <span className="aviso">(feria de saldos: esas prendas no se pueden devolver)</span></span>
        </label>

        <h2 style={{ margin: "6px 0 0" }}>3. Revisá y activá</h2>
        <div className="vuelto" style={{ fontSize: 17 }}>
          <strong>{cuando}, en {donde}:</strong> {listo ? frase : "poné el precio por prenda."}
        </div>
        {choques.length > 0 && (
          <p className="alerta" style={{ margin: 0 }}>
            Esos días ya hay: {choques.map((p) => `${p.nombre} (${p.sucursales.length ? p.sucursales.map(nombreSucursal).join(", ") : "todos"})`).join(" · ")}. No se suman: en cada venta va la que más descuenta.
          </p>
        )}
        <input placeholder={`Nombre (opcional; si no, "${listo ? textoPromo(datos) : "…"}")`} value={form.nombre} maxLength={60} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
        <button className="principal" type="submit" disabled={ocupado || !listo}>
          {ocupado ? "Guardando…" : form.desde === hoy() ? "Activar ahora" : `Programar para el ${diaLindo(form.desde)}`}
        </button>
      </form>

      <h2>Promos cargadas</h2>
      <div className="tarjeta" style={{ overflowX: "auto", marginBottom: 24 }}>
        <table>
          <thead><tr><th>Promo</th><th>Qué hace</th><th>Locales</th><th>Fechas</th><th>Estado</th><th className="der">Ventas</th><th className="der">Descontado</th><th></th></tr></thead>
          <tbody>
            {promos.map((p) => (
              <tr key={p.id} style={{ opacity: p.estado === "vigente" || p.estado === "programada" ? 1 : 0.5 }}>
                <td><strong>{p.nombre}</strong>{p.origen !== "sistema" && <><br /><span className="interno">creada por {p.origen.replace(/^api:/, "API · ")}</span></>}</td>
                <td>{p.descripcion}</td>
                <td>{p.sucursales.length ? p.sucursales.map(nombreSucursal).join(", ") : "Todos"}</td>
                <td style={{ whiteSpace: "nowrap" }}>{p.desde === p.hasta ? diaLindo(p.desde) : `${diaLindo(p.desde)} al ${diaLindo(p.hasta)}`}</td>
                <td style={{ whiteSpace: "nowrap" }}>{ESTADO[p.estado]}</td>
                <td className="der">{p.ventas}</td>
                <td className="der">{pesos(p.descontado)}</td>
                <td className="der">{p.activa && p.estado !== "terminada" && <button className="chico" onClick={() => desactivar(p)}>Desactivar</button>}</td>
              </tr>
            ))}
            {promos.length === 0 && <tr><td colSpan={8} className="aviso">Todavía no hay promos.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Descuentos especiales hechos en las cajas</h2>
      <p className="aviso" style={{ marginTop: -8 }}>Los encargados pueden hacer un descuento a mano (hasta {TOPE_PCT}%) solo con motivo y nombre de quien lo autorizó. Acá quedan todos.</p>
      <div className="tarjeta" style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>Fecha</th><th>Local</th><th>Usuario</th><th>Ticket</th><th className="der">%</th><th className="der">Descuento</th><th className="der">Cobrado</th><th>Motivo</th><th>Autorizó</th></tr></thead>
          <tbody>
            {especiales.map((x) => (
              <tr key={x.codigo}>
                <td style={{ whiteSpace: "nowrap" }}>{new Date(x.fecha).toLocaleString("es-AR", { hour12: false, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                <td>{nombreSucursal(x.sucursal)}</td><td>{x.usuario ?? "—"}</td><td className="mono">{x.codigo}</td>
                <td className="der">{x.pct}%</td><td className="der">{pesos(x.descuento)}</td><td className="der">{pesos(x.total)}</td>
                <td>{x.motivo}</td><td>{x.autorizo}</td>
              </tr>
            ))}
            {especiales.length === 0 && <tr><td colSpan={9} className="aviso">No hubo descuentos especiales.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

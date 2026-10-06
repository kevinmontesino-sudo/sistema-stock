"use client";
import { useEffect, useRef, useState } from "react";
import { cargarProducto, obtenerMediosPago, obtenerTipos, sugerirProductos, vistaPreviaCarga } from "@/app/actions";
import { Etiqueta, type DatosEtiqueta, type PrecioEtiqueta } from "@/components/Etiqueta";
import { DEPOSITO, empresa, LOCALES } from "@/lib/empresa.config";
import { redimensionar } from "@/lib/foto";
import { imprimir } from "@/lib/imprimir";
import { useDebounced } from "@/lib/hooks";
import { capitalizar, fechaCorta, nombreSucursal, nombreTipo, normalizar, pesos, precioMedio, tipoDesdeNombre, type MedioPago, type Producto, type Reparto, type Tipo } from "@/lib/util";

type FilaLote = { sku: string; nombre: string; precio: number; precios: PrecioEtiqueta[]; ultimoIngreso: string; n: number; reparto: Reparto };
type Vista = { sku: string; existe: boolean; existente: { stockTotal: number; ultimoIngreso: string | null } | null; otrosPrecios: number[]; tipo: { codigo: string; nombre: string; nuevo: boolean } };

const etiquetasDe = (p: { sku: string; nombre: string; precios: PrecioEtiqueta[] }, n: number): DatosEtiqueta[] =>
  Array.from({ length: n }, () => ({ sku: p.sku, nombre: p.nombre, precios: p.precios }));

// Precios que se imprimen: transferencia (= lista) y efectivo, con el porcentaje que figura en la base.
function preciosDe(precio: number, medios: MedioPago[]): PrecioEtiqueta[] {
  const p = empresa.etiquetaMedios.flatMap((id) => {
    const m = medios.find((x) => x.id === id);
    return m ? [{ nombre: m.nombre, valor: precioMedio(precio, m.ajustePct) }] : [];
  });
  return p.length ? p : [{ nombre: "Precio", valor: precio }];
}

export default function Carga() {
  const [nombre, setNombre] = useState("");
  const [tipos, setTipos] = useState<Tipo[]>([]);
  const [medios, setMedios] = useState<MedioPago[]>([]);
  const [catManual, setCatManual] = useState<string | undefined>();
  const [precio, setPrecio] = useState("");
  const [cantidad, setCantidad] = useState("1");
  const [foto, setFoto] = useState<string | undefined>();
  const [reparto, setReparto] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [lote, setLote] = useState<FilaLote[]>([]);
  const [aImprimir, setAImprimir] = useState<DatosEtiqueta[]>([]);
  const [sugerencias, setSugerencias] = useState<Producto[]>([]);
  const [sel, setSel] = useState(-1);
  const [verSug, setVerSug] = useState(true);
  const [vista, setVista] = useState<Vista | null>(null);
  const nombreRef = useRef<HTMLInputElement>(null);
  const precioRef = useRef<HTMLInputElement>(null);

  const detectado = tipoDesdeNombre(nombre, tipos);
  const categoria = catManual ?? detectado?.nombre ?? "";
  const precioNum = parseInt(precio) || 0;
  const dNombre = useDebounced(nombre);
  const dPrecio = useDebounced(precioNum);
  const dCategoria = useDebounced(categoria);

  useEffect(() => {
    let vivo = true;
    obtenerTipos().then((r) => vivo && r.ok && setTipos(r.tipos));
    obtenerMediosPago().then((r) => vivo && r.ok && setMedios(r.medios));
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (aImprimir.length === 0) return;
    const t = setTimeout(() => {
      imprimir(`${empresa.etiquetaMm.ancho}mm ${empresa.etiquetaMm.alto}mm`);
      setAImprimir([]);
    }, 400);
    return () => clearTimeout(t);
  }, [aImprimir]);

  const consulta = verSug && dNombre.trim().length >= 2 ? dNombre : "";
  useEffect(() => {
    if (!consulta) return;
    let vivo = true;
    sugerirProductos(consulta).then((r) => vivo && r.ok && setSugerencias(r.productos));
    return () => { vivo = false; };
  }, [consulta]);
  const sugeridas = consulta ? sugerencias : [];

  useEffect(() => {
    let vivo = true;
    vistaPreviaCarga({ categoria: dCategoria, nombre: dNombre, precio: dPrecio }).then((r) => vivo && r.ok && setVista(r));
    return () => { vivo = false; };
  }, [dCategoria, dNombre, dPrecio]);

  function elegir(p: Producto) {
    setNombre(p.nombre);
    setCatManual(nombreTipo(p.tipo, tipos));
    setPrecio(String(p.precio));
    setVerSug(false);
    setSel(-1);
    precioRef.current?.focus();
    precioRef.current?.select();
  }

  async function guardar() {
    if (guardando) return;
    const cant = parseInt(cantidad);
    if (!nombre.trim()) return setError("Escribí el nombre de la prenda");
    if (!precioNum || precioNum <= 0) return setError("Ingresá el precio de lista");
    if (!cant || cant < 1) return setError("La cantidad tiene que ser 1 o más");
    const rep: Reparto = {};
    for (const l of LOCALES) {
      const n = parseInt(reparto[l.id] ?? "") || 0;
      if (n < 0) return setError("Las cantidades a enviar no pueden ser negativas");
      if (n > 0) rep[l.id] = n;
    }
    const enviadas = Object.values(rep).reduce((s, n) => s + n, 0);
    if (enviadas > cant) return setError(`Estás enviando ${enviadas} prendas pero cargaste ${cant}`);
    setError("");
    setGuardando(true);
    const r = await cargarProducto({ categoria, nombre, precio: precioNum, cantidad: cant, foto, reparto: rep });
    setGuardando(false);
    if (!r.ok) return setError(r.motivo);
    const p = r.producto;
    setLote((l) => {
      const i = l.findIndex((f) => f.sku === p.sku);
      if (i >= 0) {
        return l.map((f, j) => {
          if (j !== i) return f;
          const acum = { ...f.reparto };
          for (const [k, v] of Object.entries(rep)) acum[k] = (acum[k] ?? 0) + v;
          return { ...f, n: f.n + cant, reparto: acum };
        });
      }
      return [{ sku: p.sku, nombre: p.nombre, precio: p.precio, precios: preciosDe(p.precio, medios), ultimoIngreso: p.ultimoIngreso, n: cant, reparto: rep }, ...l];
    });
    setAImprimir((cola) => [...cola, ...etiquetasDe({ sku: p.sku, nombre: p.nombre, precios: preciosDe(p.precio, medios) }, cant)]);
    setNombre("");
    setCatManual(undefined);
    obtenerTipos().then((t) => t.ok && setTipos(t.tipos));
    setPrecio("");
    setCantidad("1");
    setFoto(undefined);
    setReparto({});
    setVerSug(true);
    setSel(-1);
    nombreRef.current?.focus();
  }

  function teclaNombre(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" && sugeridas.length) {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, sugeridas.length - 1));
    } else if (e.key === "ArrowUp" && sugeridas.length) {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (sel >= 0 && sugeridas[sel]) elegir(sugeridas[sel]);
      else {
        setVerSug(false);
        precioRef.current?.focus();
        precioRef.current?.select();
      }
    } else if (e.key === "Escape") {
      setVerSug(false);
    }
  }

  const enter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") guardar();
  };

  async function elegirFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setFoto(await redimensionar(f));
  }

  const queda = Math.max(0, (parseInt(cantidad) || 0) - LOCALES.reduce((s, l) => s + (parseInt(reparto[l.id] ?? "") || 0), 0));
  const etiqueta: DatosEtiqueta = { sku: vista?.sku ?? "", nombre: capitalizar(nombre) || vista?.tipo.nombre || "", precios: preciosDe(precioNum, medios) };

  return (
    <>
      <h1>Carga de mercadería · {nombreSucursal(DEPOSITO)}</h1>
      <div className="grilla no-print">
        <div className="tarjeta">
          <div className="campo">
            <span>1. Nombre de la prenda</span>
            <input ref={nombreRef} type="text" value={nombre} autoFocus autoComplete="off"
              onChange={(e) => { setNombre(e.target.value); setVerSug(true); setSel(-1); }}
              onKeyDown={teclaNombre} placeholder="remera oversize lisa" />
            {sugeridas.length > 0 && (
              <div className="sugerencias" role="listbox" aria-label="Prendas ya cargadas">
                {sugeridas.map((p, i) => (
                  <button key={p.sku} role="option" aria-selected={i === sel} className={i === sel ? "sel" : ""}
                    onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(p)}>
                    <span>{p.nombre} <small>· último ing {fechaCorta(p.ultimoIngreso)} · stock {Object.values(p.stock).reduce((s, n) => s + n, 0)} · {p.sku}</small></span>
                    <strong>{pesos(p.precio)}</strong>
                  </button>
                ))}
              </div>
            )}
            <label className="fila" style={{ gap: 8, marginTop: 8 }}>
              <span style={{ fontSize: 13 }}>Categoría</span>
              <input type="text" list="categorias" value={catManual ?? ""} autoComplete="off"
                placeholder={detectado?.nombre ?? "Otro (opcional)"} style={{ flex: 1, minWidth: 160 }}
                onChange={(e) => setCatManual(e.target.value === "" ? undefined : e.target.value)} onKeyDown={enter} />
              <datalist id="categorias">
                {tipos.map((t) => <option key={t.codigo} value={t.nombre} />)}
              </datalist>
            </label>
            <div className="fila" style={{ marginTop: 6 }}>
              {tipos.filter((t) => t.codigo !== "OTR").slice(0, 8).map((t) => (
                <button key={t.codigo} className={`chico ${normalizar(categoria) === normalizar(t.nombre) ? "on" : ""}`} onClick={() => setCatManual(t.nombre)}>
                  {t.nombre}
                </button>
              ))}
            </div>
            <p className="nota">
              {vista?.tipo.nuevo ? (
                <>Categoría nueva <strong>{vista.tipo.nombre}</strong>: se crea al guardar (código <strong>{vista.tipo.codigo}</strong>).</>
              ) : (
                <>Categoría: <strong>{vista?.tipo.nombre ?? "…"}</strong>{catManual ? "" : detectado ? " (detectada)" : " (sin categoría: queda como Otro. Escribila arriba si querés una)"}</>
              )}
            </p>
          </div>

          <div className="campo">
            <span>2. Precio de lista</span>
            <div className="fila">
              <input ref={precioRef} type="number" inputMode="numeric" min={0} step={500} value={precio}
                onChange={(e) => setPrecio(e.target.value)} onKeyDown={enter} placeholder="17500" style={{ width: 130 }} />
              {empresa.preciosFrecuentes.map((p) => (
                <button key={p} className="chico" onClick={() => setPrecio(String(p))}>{p.toLocaleString("es-AR")}</button>
              ))}
            </div>
            {precioNum > 0 && (
              <p className="nota">
                {preciosDe(precioNum, medios).map((p) => `${p.nombre}: ${pesos(p.valor)}`).join(" · ")}
              </p>
            )}
            {vista && vista.otrosPrecios.length > 0 && precioNum > 0 && (
              <p className="nota">
                Ya hay &quot;{capitalizar(nombre)}&quot; a {vista.otrosPrecios.map(pesos).join(", ")}. Con este precio se crea un producto aparte (SKU nuevo).
              </p>
            )}
          </div>

          <div className="fila" style={{ alignItems: "flex-end" }}>
            <div className="campo">
              <span>3. Cantidad</span>
              <input type="number" inputMode="numeric" min={1} value={cantidad}
                onChange={(e) => setCantidad(e.target.value)} onKeyDown={enter} style={{ width: 90 }} />
            </div>
            <div className="campo" style={{ flex: 1, minWidth: 160 }}>
              <span>Foto (opcional)</span>
              <div className="fila">
                <input type="file" accept="image/*" capture="environment" onChange={elegirFoto} />
                {foto && <img src={foto} alt="Foto de la prenda" className="miniatura" />}
              </div>
            </div>
          </div>

          <div className="campo">
            <span>Enviar a los locales (opcional). Lo que no envíes queda en el {nombreSucursal(DEPOSITO)}. Lo enviado queda en camino hasta que cada local lo reciba.</span>
            <div className="fila">
              {LOCALES.map((l) => (
                <label key={l.id} className="fila" style={{ gap: 6 }}>
                  <span style={{ fontSize: 14 }}>{l.nombre}</span>
                  <input type="number" inputMode="numeric" min={0} value={reparto[l.id] ?? ""} placeholder="0"
                    onChange={(e) => setReparto((r) => ({ ...r, [l.id]: e.target.value }))} onKeyDown={enter} style={{ width: 80 }} />
                </label>
              ))}
            </div>
            <p className="nota">Queda en depósito: <strong>{queda}</strong></p>
          </div>
          <button className="principal" style={{ width: "100%" }} onClick={guardar} disabled={guardando}>
            {guardando ? "Guardando…" : "Guardar e imprimir (Enter)"}
          </button>
          <p className="error" role="alert">{error}</p>
        </div>

        <div>
          <p className="rotulo">Así sale la etiqueta ({empresa.etiquetaMm.ancho}x{empresa.etiquetaMm.alto} mm)</p>
          <Etiqueta {...etiqueta} />
          <p className="aviso">
            {vista?.existente
              ? `Recarga: este producto ya existe (hay ${vista.existente.stockTotal} en total${vista.existente.ultimoIngreso ? `, último ingreso ${fechaCorta(vista.existente.ultimoIngreso)}` : ""}). Se suma al mismo SKU y la fecha de ingreso pasa a hoy.`
              : "Producto nuevo (SKU nuevo)."}
          </p>
          <p className="aviso">Las prendas iguales comparten SKU: se imprime una etiqueta por prenda con el mismo código.</p>
          <p className="aviso">La fecha de ingreso es solo interna: no sale en la etiqueta.</p>
        </div>
      </div>

      <h2 className="no-print">Cargado en este lote</h2>
      <div className="tarjeta no-print">
        {lote.length === 0 ? (
          <p className="aviso">Todavía no se cargó nada.</p>
        ) : (
          <table>
            <thead><tr><th>SKU</th><th>Prenda</th><th>Precio</th><th className="der">Etiquetas</th><th>Enviadas a</th><th></th></tr></thead>
            <tbody>
              {lote.map((f) => (
                <tr key={f.sku}>
                  <td className="mono">{f.sku}</td>
                  <td>{f.nombre} <span className="interno">· ing {fechaCorta(f.ultimoIngreso)}</span></td>
                  <td>{pesos(f.precio)}</td>
                  <td className="der">{f.n}</td>
                  <td className="aviso">{LOCALES.filter((l) => f.reparto[l.id]).map((l) => `${l.nombre} ${f.reparto[l.id]}`).join(" · ") || "—"}</td>
                  <td className="der">
                    <button className="chico" onClick={() => setAImprimir((cola) => [...cola, ...etiquetasDe(f, f.n)])}>Reimprimir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="solo-impresion" aria-hidden="true">
        {aImprimir.map((d, i) => <Etiqueta key={i} {...d} />)}
      </div>
    </>
  );
}

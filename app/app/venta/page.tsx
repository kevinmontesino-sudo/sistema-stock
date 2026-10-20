"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buscarProductos, cajaDeHoy, cobrarVenta, obtenerMediosPago, obtenerNota, obtenerProducto } from "@/app/actions";
import { Ticket, type DatosTicket } from "@/components/Ticket";
import { empresa } from "@/lib/empresa.config";
import { imprimir } from "@/lib/imprimir";
import { useAutoTicket, useDebounced, useSucursal, useEscaner } from "@/lib/hooks";
import {
  calcularPagos, ES_CODIGO_NOTA, ES_CODIGO_VENTA, fechaCorta, montoNotaAplicable, nombreSucursal, pesos, precioMedio,
  type MedioPago, type NotaCredito, type PagoEntrada, type Producto,
} from "@/lib/util";

type Linea = { producto: Producto; cant: number };
type Caja = { id: string; nombre: string; ventas: number; total: number };

// Hash corto del contenido de la venta: la misma clave solo vale para el mismo carrito y los mismos pagos.
const hashTexto = (t: string) => { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0; return h.toString(36); };
const ES_SKU = /^[a-z]{3}\d{6}$/i;
const SIN_LINEAS: Linea[] = [];

function mensajeSinStock(p: Producto, sucursal: string) {
  const otras = empresa.sucursales
    .filter((s) => s.id !== sucursal && (p.stock[s.id] ?? 0) > 0)
    .map((s) => `${p.stock[s.id]} en ${s.nombre}`);
  const camino = p.enCamino[sucursal] ? ` Hay ${p.enCamino[sucursal]} en camino a este local: recibilos en Distribuir → Recibir.` : "";
  return `${p.nombre} no tiene stock en ${nombreSucursal(sucursal)}.${otras.length ? ` Hay ${otras.join(", ")}.` : ""}${camino}`;
}
const etiquetaPct = (pct: number) => (pct === 0 ? "precio de lista" : `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`);

export default function VentaPage() {
  const [sucursal] = useSucursal();
  const [autoTicket, setAutoTicket] = useAutoTicket();
  // El carrito pertenece a una sucursal: si se cambia de local, no queda nada del otro.
  const [carrito, setCarrito] = useState<{ suc: string; items: Linea[] }>({ suc: sucursal, items: [] });
  const lineas = useMemo(() => (carrito.suc === sucursal ? carrito.items : SIN_LINEAS), [carrito, sucursal]);
  const setLineas = useCallback(
    (fn: (l: Linea[]) => Linea[]) => setCarrito((c) => ({ suc: sucursal, items: fn(c.suc === sucursal ? c.items : []) })),
    [sucursal],
  );
  const [manual, setManual] = useState("");
  const [aviso, setAviso] = useState("");
  const [nota, setNota] = useState<NotaCredito | null>(null);
  const [saldoNota, setSaldoNota] = useState<{ codigo: string; saldo: number } | null>(null);
  const [ultima, setUltima] = useState<DatosTicket | null>(null);
  const [cobrando, setCobrando] = useState(false);
  const [aImprimir, setAImprimir] = useState(false);
  const [verTicket, setVerTicket] = useState(false);
  const [medios, setMedios] = useState<MedioPago[]>([]);
  const [medioSel, setMedioSel] = useState<string | null>(null);
  const [mixto, setMixto] = useState(false);
  // Pago con dos medios: primero lo que entrega el cliente (pago1) y el resto lo paga el otro medio (pago2).
  const [pago1, setPago1] = useState("efectivo");
  const [pago2, setPago2] = useState("transferencia");
  const [entrega1, setEntrega1] = useState("");
  const [recibido, setRecibido] = useState("");
  const [caja, setCaja] = useState<{ filas: Caja[]; ventas: number }>({ filas: [], ventas: 0 });
  const [version, setVersion] = useState(0);
  const [sugeridas, setSugeridas] = useState<Producto[]>([]);
  const [sel, setSel] = useState(-1);
  const lineasRef = useRef<Linea[]>([]);
  // Identifica este intento de cobro: si hay que reintentarlo tras un corte, el servidor no duplica la venta.
  const claveCobro = useRef(crypto.randomUUID());

  useEffect(() => { lineasRef.current = lineas; }, [lineas]);

  useEffect(() => {
    let vivo = true;
    obtenerMediosPago().then((r) => vivo && r.ok && setMedios(r.medios));
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    let vivo = true;
    cajaDeHoy(sucursal).then((r) => vivo && r.ok && setCaja(r.caja));
    return () => { vivo = false; };
  }, [sucursal, version]);

  // Solo se puede vender lo que hay en esta sucursal.
  const agregarProducto = useCallback((p: Producto) => {
    const hay = p.stock[sucursal] ?? 0;
    if (hay <= 0) return setAviso(mensajeSinStock(p, sucursal));
    const actual = lineasRef.current.find((x) => x.producto.sku === p.sku)?.cant ?? 0;
    if (actual + 1 > hay) return setAviso(`De ${p.nombre} solo hay ${hay} en ${nombreSucursal(sucursal)}`);
    setAviso("");
    setUltima(null);
    setLineas((l) => {
      const i = l.findIndex((x) => x.producto.sku === p.sku);
      if (i >= 0) return l.map((x, j) => (j === i ? { ...x, cant: x.cant + 1 } : x));
      return [...l, { producto: p, cant: 1 }];
    });
  }, [sucursal, setLineas]);

  const agregar = useCallback(async (codigo: string) => {
    const texto = codigo.trim();
    if (!texto) return;
    if (ES_CODIGO_VENTA.test(texto)) return setAviso("Ese es el ticket de una venta. Para devolver prendas usá «Devolución».");
    if (ES_CODIGO_NOTA.test(texto)) {
      const n = await obtenerNota(texto);
      if (!n.ok) return setAviso(n.motivo);
      if (n.nota.estado === "usada") return setAviso(`La nota ${n.nota.codigo} ya fue usada`);
      setAviso("");
      setUltima(null);
      setSaldoNota(null);
      setNota(n.nota);
      return;
    }
    const r = await obtenerProducto(texto);
    if (!r.ok) return setAviso(r.motivo);
    agregarProducto(r.producto);
  }, [agregarProducto]);

  // Sugerencias por nombre: solo prendas con stock en este local, las que mas tienen arriba.
  const dManual = useDebounced(manual, 200);
  const consulta = dManual.trim().length >= 2 && !ES_SKU.test(dManual.trim()) ? dManual : "";
  const ordenar = useCallback((ps: Producto[]) => [...ps].sort((a, b) => (b.stock[sucursal] ?? 0) - (a.stock[sucursal] ?? 0)).slice(0, 8), [sucursal]);
  useEffect(() => {
    if (!consulta) return;
    let vivo = true;
    buscarProductos({ q: consulta, sucursalConStock: sucursal }).then((r) => vivo && r.ok && setSugeridas(ordenar(r.productos)));
    return () => { vivo = false; };
  }, [consulta, sucursal, ordenar]);
  const lista = consulta ? sugeridas : [];

  async function confirmar() {
    const t = manual.trim();
    if (!t) return;
    setManual("");
    setSel(-1);
    if (sel >= 0 && lista[sel]) return agregarProducto(lista[sel]);
    if (ES_SKU.test(t)) return agregar(t);
    const r = await buscarProductos({ q: t, sucursalConStock: sucursal });
    const primero = r.ok ? ordenar(r.productos)[0] : undefined;
    if (primero) return agregarProducto(primero);
    setAviso(`No hay ninguna prenda con stock en ${nombreSucursal(sucursal)} para "${t}"`);
  }

  function teclaBuscador(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" && lista.length) {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, lista.length - 1));
    } else if (e.key === "ArrowUp" && lista.length) {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, -1));
    } else if (e.key === "Escape") {
      setManual("");
      setSel(-1);
    }
  }

  useEscaner(agregar);

  const subtotal = lineas.reduce((s, f) => s + f.producto.precio * f.cant, 0);
  const cantidadTotal = lineas.reduce((s, f) => s + f.cant, 0);

  // Pagos: un solo medio (paga todo) o dos (el primero entrega un monto y el segundo paga lo que falta).
  const entrega1Num = parseInt(entrega1) || 0;
  // Nota de credito escaneada: entra como un primer pago (cubre lo que alcance) y el resto se paga con un medio normal.
  const notaMonto = nota && subtotal > 0 ? montoNotaAplicable(subtotal, nota.saldo, nota.ajustePct) : 0;
  const notaCubre = nota && notaMonto > 0 ? Math.round(notaMonto / (1 + nota.ajustePct / 100)) : 0;
  const restoLista = Math.max(0, subtotal - notaCubre);
  const medioNota: MedioPago | null = nota && notaMonto > 0 ? { id: `nota:${nota.codigo}`, nombre: `Nota de crédito ${nota.codigo}`, ajustePct: nota.ajustePct } : null;
  const pagosBase: PagoEntrada[] = mixto
    ? entrega1Num > 0 ? [{ medioId: pago1, monto: entrega1Num }, { medioId: pago2, monto: null }] : []
    : medioSel ? [{ medioId: medioSel, monto: null }] : [];
  const pagos: PagoEntrada[] = !medioNota ? pagosBase
    : restoLista === 0 ? [{ medioId: medioNota.id, monto: notaMonto }, { medioId: "transferencia", monto: null }]
    : pagosBase.length ? [{ medioId: medioNota.id, monto: notaMonto }, ...pagosBase] : [];
  const calc = pagos.length ? calcularPagos(subtotal, medioNota ? [...medios, medioNota] : medios, pagos) : null;
  const otroDe = (id: string) => (id === "efectivo" ? "transferencia" : id === "transferencia" ? "efectivo" : "transferencia");
  function elegirPago1(id: string) {
    setPago1(id);
    if (id === pago2) setPago2(otroDe(id));
    setRecibido("");
  }

  // Vuelto: si hay una parte en efectivo, el cajero escribe cuanto entrega el cliente.
  const pagoEfectivo = calc && calc.ok ? calc.pagos.find((p) => p.medioId === "efectivo") : undefined;
  const recibidoNum = parseInt(recibido) || 0;
  const vuelto = pagoEfectivo && recibidoNum > 0 ? recibidoNum - pagoEfectivo.monto : null;
  const billetes = pagoEfectivo
    ? [...new Set([1000, 5000, 10000, 20000].map((u) => Math.ceil(pagoEfectivo.monto / u) * u))].filter((x) => x > pagoEfectivo.monto).slice(0, 4)
    : [];

  async function cobrar() {
    if (cobrando || !calc || !calc.ok) return;
    if (vuelto !== null && vuelto < 0) return setAviso(`El cliente entrega menos de lo que falta en efectivo (${pesos(pagoEfectivo!.monto)})`);
    setCobrando(true);
    const r = await cobrarVenta(sucursal, lineas.map((l) => ({ sku: l.producto.sku, cant: l.cant })), pagos, `${claveCobro.current}-${hashTexto(JSON.stringify([sucursal, lineas.map((l) => [l.producto.sku, l.cant]), pagos]))}`);
    setCobrando(false);
    if (!r.ok) return setAviso(r.motivo);
    claveCobro.current = crypto.randomUUID();
    if (nota && notaMonto > 0 && nota.saldo - notaMonto > 0) setSaldoNota({ codigo: nota.codigo, saldo: nota.saldo - notaMonto });
    setNota(null);
    setUltima({ ...r.venta, sucursal, recibido: pagoEfectivo && recibidoNum >= pagoEfectivo.monto ? recibidoNum : undefined });
    if (autoTicket) setAImprimir(true);
    setAviso("");
    setLineas(() => []);
    setMedioSel(null);
    setMixto(false);
    setEntrega1("");
    setRecibido("");
    setVersion((v) => v + 1);
  }

  useEffect(() => {
    if (!aImprimir) return;
    const t = setTimeout(() => {
      imprimir(`${empresa.ticketMm.ancho}mm auto`);
      setAImprimir(false);
    }, 300);
    return () => clearTimeout(t);
  }, [aImprimir]);

  // Las notas de credito no son plata que entra a la caja: se muestran aparte y no suman al total cobrado.
  const filasCaja = caja.filas.filter((c) => c.id !== "nota_credito");
  const notasCaja = caja.filas.find((c) => c.id === "nota_credito");
  const totalCaja = filasCaja.reduce((s, c) => s + c.total, 0);
  const textoCobrar = !lineas.length ? "Cobrar"
    : !calc ? (mixto ? "Escribí cuánto entrega el cliente" : "Elegí cómo paga")
    : !calc.ok ? "Completá el pago"
    : `Cobrar ${pesos(calc.total)} · ${calc.pagos.map((p) => p.nombre).join(" + ")}`;

  return (
    <>
      <h1>Venta · {nombreSucursal(sucursal)}</h1>
      <div className="no-print" style={{ marginBottom: 12 }}>
        <form className="fila" onSubmit={(e) => { e.preventDefault(); confirmar(); }}>
          <input type="text" value={manual} autoComplete="off" autoFocus
            onChange={(e) => { setManual(e.target.value); setSel(-1); }} onKeyDown={teclaBuscador}
            placeholder="Escaneá una prenda, o escribí el nombre o el SKU" style={{ flex: 1, minWidth: 200 }} />
          <button type="submit">Agregar</button>
        </form>
        {lista.length > 0 && (
          <div className="sugerencias" role="listbox" aria-label="Prendas con stock en este local">
            {lista.map((p, i) => (
              <button key={p.sku} role="option" aria-selected={i === sel} className={i === sel ? "sel" : ""}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { agregarProducto(p); setManual(""); setSel(-1); }}>
                <span>{p.nombre} <small>· {p.sku}</small></span>
                <span><strong>{pesos(p.precio)}</strong> <small>{p.stock[sucursal] ?? 0} acá</small></span>
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="error no-print" role="alert" style={{ margin: "0 0 8px" }}>{aviso}</p>

      <div className="tarjeta no-print">
        {lineas.length === 0 ? (
          <p className="aviso">Escaneá una prenda para empezar. Solo se pueden vender prendas que están en {nombreSucursal(sucursal)}.</p>
        ) : (
          <table>
            <thead><tr><th></th><th>SKU</th><th>Prenda</th><th className="der">Cant.</th><th className="der">Precio de lista</th><th></th></tr></thead>
            <tbody>
              {lineas.map((f) => (
                <tr key={f.producto.sku}>
                  <td>{f.producto.foto && <img src={f.producto.foto} alt="" className="miniatura" />}</td>
                  <td className="mono">{f.producto.sku}</td>
                  <td>
                    {f.producto.nombre} <span className="interno">· ing {fechaCorta(f.producto.ultimoIngreso)} · hay {f.producto.stock[sucursal] ?? 0} acá</span>
                  </td>
                  <td className="der">{f.cant}</td>
                  <td className="der">{pesos(f.producto.precio * f.cant)}</td>
                  <td className="der"><button className="chico" onClick={() => setLineas((l) => l.filter((x) => x.producto.sku !== f.producto.sku))}>Quitar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="fila" style={{ justifyContent: "space-between", marginTop: 16 }}>
          <span className="aviso">{cantidadTotal} prendas · subtotal a precio de lista</span>
          <span style={{ fontSize: 18, fontWeight: 600 }}>{pesos(subtotal)}</span>
        </div>

        {nota && (
          <div className="vuelto" style={{ marginTop: 12 }}>
            <div className="fila" style={{ justifyContent: "space-between" }}>
              <span>Nota de crédito <strong>{nota.codigo}</strong> · vale {pesos(nota.saldo)}</span>
              <button className="chico" onClick={() => setNota(null)}>Quitar nota</button>
            </div>
            {lineas.length === 0 ? (
              <p className="aviso" style={{ margin: "6px 0 0" }}>Escaneá las prendas que se lleva el cliente: la nota se descuenta del total.</p>
            ) : (
              <p style={{ margin: "6px 0 0" }}>
                Se descuenta <strong>{pesos(notaMonto)}</strong>
                {restoLista === 0 ? ": la nota cubre toda la compra." : <> (cubre {pesos(notaCubre)} de lista). Falta pagar {pesos(restoLista)} a precio de lista.</>}
                {notaMonto < nota.saldo && <> Queda un saldo de {pesos(nota.saldo - notaMonto)} en la nota.</>}
              </p>
            )}
          </div>
        )}

        {lineas.length > 0 && !mixto && restoLista > 0 && (
          <>
            <p className="rotulo" style={{ margin: "16px 0 8px" }}>¿Cómo paga?</p>
            <div className="medios">
              {medios.map((m) => (
                <button key={m.id} className={`medio ${m.id === medioSel ? "elegido" : ""}`} onClick={() => { setMedioSel(m.id); setRecibido(""); }} aria-pressed={m.id === medioSel}>
                  <span className="medio-nombre">{m.nombre}</span>
                  <span className="medio-monto">{pesos(precioMedio(restoLista, m.ajustePct))}</span>
                  <span className="medio-pct">{etiquetaPct(m.ajustePct)}</span>
                </button>
              ))}
            </div>
            <button className="chico" style={{ marginTop: 8 }} onClick={() => { setMixto(true); setMedioSel(null); setRecibido(""); setPago1("efectivo"); setPago2("transferencia"); setEntrega1(""); }}>
              Pagar con más de un medio
            </button>
          </>
        )}

        {lineas.length > 0 && mixto && (
          <div style={{ marginTop: 16 }}>
            <p className="rotulo" style={{ margin: "0 0 8px" }}>Pago con dos medios</p>
            <p className="aviso" style={{ margin: "0 0 4px" }}>1. Lo que entrega el cliente primero</p>
            <div className="fila" style={{ marginBottom: 6 }}>
              {medios.map((m) => (
                <button key={m.id} className={`chico ${m.id === pago1 ? "on" : ""}`} onClick={() => elegirPago1(m.id)}>
                  {m.nombre} <small>({etiquetaPct(m.ajustePct)})</small>
                </button>
              ))}
              <input type="number" inputMode="numeric" min={0} placeholder="Entrega $" value={entrega1} autoFocus
                onChange={(e) => setEntrega1(e.target.value)} style={{ width: 160 }} />
            </div>
            {calc && calc.ok && calc.pagos[0].medioId === pago1 && (
              <p className="nota" style={{ marginTop: 0 }}>Eso cubre <strong>{pesos(calc.pagos[0].valorLista)}</strong> del valor de lista.</p>
            )}
            {calc && !calc.ok && <p className="nota">{calc.motivo === "Lo que entrega el cliente supera el total de la compra" ? "Con eso ya paga todo: usá «Volver a un solo medio»." : calc.motivo}</p>}

            <p className="aviso" style={{ margin: "10px 0 4px" }}>2. El resto lo paga con</p>
            <div className="fila" style={{ marginBottom: 6 }}>
              {medios.filter((m) => m.id !== pago1).map((m) => (
                <button key={m.id} className={`chico ${m.id === pago2 ? "on" : ""}`} onClick={() => setPago2(m.id)}>
                  {m.nombre} <small>({etiquetaPct(m.ajustePct)})</small>
                </button>
              ))}
            </div>
            {calc && calc.ok && (() => {
              const p2 = calc.pagos.find((p) => p.medioId === pago2);
              return (
                <>
                  <p style={{ margin: "6px 0", fontSize: 20 }}>
                    {p2 ? <>Tiene que entregar con {p2.nombre}: <strong className="vuelto-monto">{pesos(p2.monto)}</strong></> : "No queda resto por pagar."}
                  </p>
                  <p className="aviso" style={{ margin: 0 }}>
                    Total a cobrar {pesos(calc.total)} · {calc.total === subtotal ? "sin ajuste" : `${calc.total > subtotal ? "recargo" : "descuento"} de ${pesos(Math.abs(calc.total - subtotal))} sobre el precio de lista`}
                  </p>
                </>
              );
            })()}
            <button className="chico" style={{ marginTop: 8 }} onClick={() => { setMixto(false); setEntrega1(""); setRecibido(""); }}>
              Volver a un solo medio
            </button>
          </div>
        )}

        {pagoEfectivo && !(mixto && pago1 === "efectivo") && (
          <div className="vuelto">
            <div className="fila" style={{ justifyContent: "space-between" }}>
              <span>Efectivo a cobrar</span>
              <strong style={{ fontSize: 18 }}>{pesos(pagoEfectivo.monto)}</strong>
            </div>
            <div className="fila" style={{ justifyContent: "space-between", marginTop: 8 }}>
              <label className="fila" style={{ gap: 8 }}>
                <span>El cliente entrega</span>
                <input type="number" inputMode="numeric" min={0} placeholder="$" value={recibido}
                  onChange={(e) => setRecibido(e.target.value)} style={{ width: 150 }} />
              </label>
              <div className="fila" style={{ gap: 6 }}>
                <button className="chico" onClick={() => setRecibido(String(pagoEfectivo.monto))}>Justo</button>
                {billetes.map((b) => (
                  <button key={b} className="chico" onClick={() => setRecibido(String(b))}>{b.toLocaleString("es-AR")}</button>
                ))}
              </div>
            </div>
            {vuelto !== null && (
              <div className="fila" style={{ justifyContent: "space-between", marginTop: 8 }}>
                <span>{vuelto < 0 ? "Falta" : "Vuelto"}</span>
                <strong className={vuelto < 0 ? "sin-stock" : "vuelto-monto"}>{pesos(Math.abs(vuelto))}</strong>
              </div>
            )}
          </div>
        )}

        <button className="principal" style={{ width: "100%", marginTop: 12 }} onClick={cobrar}
          disabled={lineas.length === 0 || !calc || !calc.ok || cobrando}>
          {cobrando ? "Registrando…" : textoCobrar}
        </button>
        <label className="fila" style={{ gap: 8, marginTop: 8, fontSize: 14 }}>
          <input type="checkbox" checked={autoTicket} onChange={(e) => setAutoTicket(e.target.checked)} />
          <span>Imprimir el ticket automáticamente al cobrar (en esta PC)</span>
        </label>
      </div>

      {ultima && (
        <div className="tarjeta no-print" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Venta {ultima.codigo} registrada</h2>
          <table>
            <tbody>
              {ultima.items.map((i) => (
                <tr key={i.sku}><td>{i.cant} × {i.nombre}</td><td className="der">{pesos(i.precio * i.cant)}</td></tr>
              ))}
              <tr><td className="aviso">Subtotal a precio de lista</td><td className="der">{pesos(ultima.subtotal)}</td></tr>
              {ultima.pagos.map((p) => (
                <tr key={p.medioId}><td className="aviso">Pagó con {p.nombre} ({etiquetaPct(p.pct)}){ultima.pagos.length > 1 ? `, cubre ${pesos(p.valorLista)} de lista` : ""}</td><td className="der">{pesos(p.monto)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="total" style={{ textAlign: "right", margin: "8px 0 0" }}>{pesos(ultima.total)}</p>
          {ultima.recibido !== undefined && (() => {
            const ef = ultima.pagos.find((p) => p.medioId === "efectivo");
            return ef ? (
              <p style={{ textAlign: "right", margin: "4px 0 0", fontSize: 18 }}>
                Recibido {pesos(ultima.recibido)} · <strong className="vuelto-monto">Vuelto {pesos(ultima.recibido - ef.monto)}</strong>
              </p>
            ) : null;
          })()}
          {saldoNota && <p className="alerta">A la nota {saldoNota.codigo} le quedan {pesos(saldoNota.saldo)}: el cliente puede usarla de nuevo cuando quiera.</p>}
          <p className="aviso">Ticket interno · No válido como factura.</p>
          <div className="fila" style={{ gap: 8, marginTop: 8 }}>
            <button onClick={() => setAImprimir(true)}>Imprimir ticket</button>
            <button onClick={() => setVerTicket((v) => !v)}>{verTicket ? "Ocultar ticket" : "Ver ticket en pantalla"}</button>
          </div>
          {verTicket && <div style={{ marginTop: 12, boxShadow: "0 0 0 1px var(--borde)", width: "fit-content" }}><Ticket venta={ultima} /></div>}
        </div>
      )}
      {ultima && (
        <div className="solo-ticket" aria-hidden="true">
          <Ticket venta={ultima} />
        </div>
      )}

      <h2 className="no-print">Caja de hoy · {nombreSucursal(sucursal)}</h2>
      <div className="tarjeta no-print">
        {caja.filas.length === 0 ? (
          <p className="aviso">Todavía no hay ventas hoy en este local.</p>
        ) : (
          <table>
            <thead><tr><th>Medio de pago</th><th className="der">Ventas</th><th className="der">Cobrado</th></tr></thead>
            <tbody>
              {filasCaja.map((c) => (
                <tr key={c.id}><td>{c.nombre}</td><td className="der">{c.ventas}</td><td className="der">{pesos(c.total)}</td></tr>
              ))}
              <tr><td><strong>Total cobrado</strong></td><td className="der"><strong>{caja.ventas} ventas</strong></td><td className="der"><strong>{pesos(totalCaja)}</strong></td></tr>
              {notasCaja && <tr><td className="aviso">Pagado con notas de crédito (no entra a la caja)</td><td className="der aviso">{notasCaja.ventas}</td><td className="der aviso">{pesos(notasCaja.total)}</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

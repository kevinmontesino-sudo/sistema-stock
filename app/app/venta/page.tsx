"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buscarProductos, cajaDeHoy, cobrarVenta, obtenerMediosPago, obtenerNota, obtenerProducto, productoSinCargar, promosDeHoy } from "@/app/actions";
import { Ticket, type DatosTicket } from "@/components/Ticket";
import { DEPOSITO, empresa } from "@/lib/empresa.config";
import { ticketVentaEscpos } from "@/lib/escpos";
import { imprimirTicketPreferido } from "@/lib/imprimirTicket";
import { descripcionPromo, descuentoEspecial, mediosParaPromo, mejorPromo, sugerenciaPromo, textoPromo, TOPE_PCT, type Promo } from "@/lib/promos";
import { useAutoTicket, useDebounced, useSucursal, useEscaner } from "@/lib/hooks";
import {
  calcularPagos, mediosDelCarrito, ES_CODIGO_NOTA, ES_CODIGO_VENTA, montoNotaAplicable, nombreSucursal, pctTexto, pesos, precioMedio,
  type MedioPago, type NotaCredito, type PagoEntrada, type Producto,
} from "@/lib/util";

// origen: de que stock sale la prenda. Casi siempre es el propio local; el deposito tambien puede vender con el stock de San Lorenzo.
// faltante: la prenda esta en el local pero el sistema no la tiene; al cobrar se corrige el stock (traer de otra sucursal o sumarla).
type Faltante = { modo: "traer"; desde: string } | { modo: "sin_cargar" };
type Linea = { producto: Producto; cant: number; origen: string; faltante?: Faltante };
// Cuantas se pueden vender en una linea: lo que hay en su stock, mas lo que se puede pasar de la otra sucursal (o sin tope si no estaba cargada).
const topeLinea = (l: Linea) => (l.faltante?.modo === "sin_cargar" ? 999 : (l.producto.stock[l.origen] ?? 0) + (l.faltante?.modo === "traer" ? l.producto.stock[l.faltante.desde] ?? 0 : 0));
const ORIGEN_SL = "sanlorenzo";
const claveLinea = (l: { producto: { sku: string }; origen: string }) => `${l.producto.sku}|${l.origen}`;
type Caja = { id: string; nombre: string; ventas: number; total: number };

// Hash corto del contenido de la venta: la misma clave solo vale para el mismo carrito y los mismos pagos.
const hashTexto = (t: string) => { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0; return h.toString(36); };
const ES_SKU = /^[a-z]{3}\d{6}$/i;
const SIN_LINEAS: Linea[] = [];

// Stocks de los que puede vender un local: el deposito puede usar tambien el de San Lorenzo.
const origenesDe = (sucursal: string) => (sucursal === DEPOSITO ? [DEPOSITO, ORIGEN_SL] : [sucursal]);

const etiquetaPct = (pct: number) => (pct === 0 ? "precio de lista" : `${pct > 0 ? "+" : "−"}${pctTexto(pct)}`);

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
  const [pregunta, setPregunta] = useState<Producto | null>(null); // prenda sin stock en el sistema: se pregunta si esta igual en el local
  const [sinCargar, setSinCargar] = useState<{ nombre: string; precio: string } | null>(null); // vender una prenda que no esta cargada
  const [avisoOrigen, setAvisoOrigen] = useState(""); // el deposito vendiendo con stock de San Lorenzo: se avisa (no es un error)
  const [ultimoSku, setUltimoSku] = useState<string | null>(null); // la ultima prenda escaneada se resalta en la lista
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
  // Promos de hoy en este local (se aplican solas) y descuento especial (a mano, con motivo y quien lo autorizo).
  const [promosHoy, setPromosHoy] = useState<{ suc: string; promos: Promo[]; especial: boolean }>({ suc: "", promos: [], especial: false });
  const [formEsp, setFormEsp] = useState({ pct: "", motivo: "", autorizo: "" });
  const [especial, setEspecial] = useState<{ pct: number; motivo: string; autorizo: string } | null>(null);
  const [verEsp, setVerEsp] = useState(false);
  const [errEsp, setErrEsp] = useState("");
  const [recargaPromos, setRecargaPromos] = useState(0);
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
    const cargar = () => promosDeHoy(sucursal).then((r) => vivo && r.ok && setPromosHoy({ suc: sucursal, promos: r.promos, especial: r.especial }));
    cargar();
    // Las promos pueden cambiar durante el dia (la oficina las crea o las saca): se vuelven a pedir cada 2 minutos y al volver a la pestaña.
    const t = setInterval(cargar, 120_000);
    window.addEventListener("focus", cargar);
    return () => { vivo = false; clearInterval(t); window.removeEventListener("focus", cargar); };
  }, [sucursal, version, recargaPromos]);

  useEffect(() => {
    let vivo = true;
    cajaDeHoy(sucursal).then((r) => vivo && r.ok && setCaja(r.caja));
    return () => { vivo = false; };
  }, [sucursal, version]);

  // Solo se puede vender lo que hay en esta sucursal.
  const agregarProducto = useCallback((p: Producto) => {
    const origenes = origenesDe(sucursal);
    const hayEn = (o: string) => p.stock[o] ?? 0;
    const usadas = (o: string) => lineasRef.current.filter((x) => x.producto.sku === p.sku && x.origen === o).reduce((s, x) => s + x.cant, 0);
    // Si la prenda ya esta en el carrito y ese stock tiene lugar, se suma ahi; si no, sale del primero que tenga (el deposito antes que San Lorenzo).
    const existente = lineasRef.current.find((x) => x.producto.sku === p.sku && usadas(x.origen) + 1 <= hayEn(x.origen));
    const origen = existente?.origen ?? origenes.find((o) => usadas(o) + 1 <= hayEn(o));
    if (!origen) {
      // Si ya hay una linea de esta prenda vendiendose sin stock y todavia entra, se suma ahi.
      const conFaltante = lineasRef.current.find((x) => x.producto.sku === p.sku && x.faltante && x.cant + 1 <= topeLinea(x));
      if (conFaltante) {
        setAviso("");
        setUltimoSku(claveLinea(conFaltante));
        setLineas((l) => l.map((x) => (claveLinea(x) === claveLinea(conFaltante) ? { ...x, cant: x.cant + 1 } : x)));
        return;
      }
      // El sistema no tiene mas: se pregunta si la prenda esta igual en el local (de otra sucursal o sin cargar).
      setAviso("");
      setPregunta(p);
      return;
    }
    setAviso("");
    // El aviso solo cuando el origen se eligio solo para una linea nueva (si se suma a una linea que ya estaba, no cambia).
    if (!existente) setAvisoOrigen(origen !== sucursal ? `${p.nombre}: no hay en ${nombreSucursal(sucursal)}, se descuenta del stock de ${nombreSucursal(origen)}. Si en realidad está en ${nombreSucursal(sucursal)}, cambialo en la línea ("Sale del stock de").` : "");
    setUltima(null);
    setUltimoSku(`${p.sku}|${origen}`);
    setLineas((l) => {
      const i = l.findIndex((x) => x.producto.sku === p.sku && x.origen === origen);
      if (i >= 0) return l.map((x, j) => (j === i ? { ...x, cant: x.cant + 1 } : x));
      return [...l, { producto: p, cant: 1, origen }];
    });
  }, [sucursal, setLineas]);

  // Botones + y − de cada renglon: no se puede pasar del stock de este local ni bajar de 1 (para sacarla esta "Quitar").
  const cambiarCantidad = useCallback((clave: string, delta: number) => {
    const f = lineasRef.current.find((x) => claveLinea(x) === clave);
    if (!f) return;
    if (delta > 0 && f.cant + 1 > topeLinea(f)) {
      if (!f.faltante) return setPregunta(f.producto);
      return setAviso(`De ${f.producto.nombre} no se pueden vender más de ${topeLinea(f)}`);
    }
    setAviso("");
    setUltimoSku(clave);
    setLineas((l) => l.map((x) => (claveLinea(x) === clave ? { ...x, cant: Math.max(1, x.cant + delta) } : x)));
  }, [setLineas]);

  // Solo el deposito: elegir de que stock sale la prenda (Deposito o San Lorenzo). Si ya hay otra linea de esa prenda con el otro stock, se juntan.
  const cambiarOrigen = useCallback((clave: string, nuevo: string) => {
    const f = lineasRef.current.find((x) => claveLinea(x) === clave);
    if (!f || f.origen === nuevo) return;
    if (f.faltante) return setAviso("Esta línea se vende sin stock en el sistema: para cambiar de dónde sale, quitala y volvé a agregarla.");
    const otra = lineasRef.current.find((x) => x.producto.sku === f.producto.sku && x.origen === nuevo);
    const total = f.cant + (otra?.cant ?? 0);
    const hay = f.producto.stock[nuevo] ?? 0;
    if (total > hay) return setAviso(`De ${f.producto.nombre} solo hay ${hay} en ${nombreSucursal(nuevo)}`);
    setAviso("");
    setAvisoOrigen(nuevo !== sucursal ? `${f.producto.nombre}: se descuenta del stock de ${nombreSucursal(nuevo)}.` : "");
    setUltimoSku(`${f.producto.sku}|${nuevo}`);
    setLineas((l) => otra
      ? l.filter((x) => claveLinea(x) !== clave).map((x) => (claveLinea(x) === claveLinea(otra) ? { ...x, cant: total } : x))
      : l.map((x) => (claveLinea(x) === clave ? { ...x, origen: nuevo } : x)));
  }, [sucursal, setLineas]);

  // Respuesta a la pregunta: la prenda esta en el local. Se agrega (o se suma) en la linea del propio stock, marcada para corregir al cobrar.
  const elegirFaltante = useCallback((p: Producto, f: Faltante) => {
    const origen = origenesDe(sucursal)[0];
    setPregunta(null);
    setAviso("");
    setUltima(null);
    setUltimoSku(`${p.sku}|${origen}`);
    setLineas((l) => {
      const i = l.findIndex((x) => x.producto.sku === p.sku && x.origen === origen);
      if (i >= 0) return l.map((x, j) => (j === i ? { ...x, cant: x.cant + 1, faltante: f } : x));
      return [...l, { producto: p, cant: 1, origen, faltante: f }];
    });
  }, [sucursal, setLineas]);

  async function agregarSinCargar() {
    if (!sinCargar) return;
    const precio = parseInt(sinCargar.precio) || 0;
    if (sinCargar.nombre.trim().length < 3) return setAviso("Escribí el nombre de la prenda");
    if (precio <= 0) return setAviso("Escribí el precio de lista (el de transferencia)");
    const r = await productoSinCargar(sinCargar.nombre, precio);
    if (!r.ok) return setAviso(r.motivo);
    setSinCargar(null);
    // Si resulta que ya estaba cargada y tiene stock aca, se vende normal; si no, sin stock (se suma al cobrar).
    const p = r.producto;
    if (origenesDe(sucursal).some((o) => (p.stock[o] ?? 0) > 0)) agregarProducto(p);
    else elegirFaltante(p, { modo: "sin_cargar" });
  }

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
  const consulta = dManual.trim().length >= 2 && ![ES_SKU, ES_CODIGO_NOTA, ES_CODIGO_VENTA].some((r) => r.test(dManual.trim())) ? dManual : "";
  const stockTotal = useCallback((p: Producto) => origenesDe(sucursal).reduce((s, o) => s + (p.stock[o] ?? 0), 0), [sucursal]);
  const ordenar = useCallback((ps: Producto[]) => [...ps].sort((a, b) => stockTotal(b) - stockTotal(a)).slice(0, 8), [stockTotal]);
  useEffect(() => {
    if (!consulta) return;
    let vivo = true;
    // Primero las que tienen stock aca; si no hay ninguna, todas (la prenda puede estar en el local aunque el sistema no la tenga).
    buscarProductos({ q: consulta, sucursalConStock: origenesDe(sucursal).join(",") }).then(async (r) => {
      if (!vivo || !r.ok) return;
      if (r.productos.length) return setSugeridas(ordenar(r.productos));
      const t = await buscarProductos({ q: consulta });
      if (vivo && t.ok) setSugeridas(t.productos.slice(0, 8));
    });
    return () => { vivo = false; };
  }, [consulta, sucursal, ordenar]);
  const lista = consulta ? sugeridas : [];

  async function confirmar() {
    const t = manual.trim();
    if (!t) return;
    setManual("");
    setSel(-1);
    if (sel >= 0 && lista[sel]) return agregarProducto(lista[sel]);
    // SKU, nota de credito o ticket escaneados con el cursor en el buscador: se tratan igual que escaneados fuera (no se buscan como nombre).
    if (ES_SKU.test(t) || ES_CODIGO_NOTA.test(t) || ES_CODIGO_VENTA.test(t)) return agregar(t);
    const r = await buscarProductos({ q: t, sucursalConStock: origenesDe(sucursal).join(",") });
    const primero = r.ok ? ordenar(r.productos)[0] : undefined;
    if (primero) return agregarProducto(primero);
    const todas = await buscarProductos({ q: t });
    if (todas.ok && todas.productos[0]) return agregarProducto(todas.productos[0]);
    setAviso(`No hay ninguna prenda cargada que coincida con "${t}". Si no está cargada, tocá «Vender una prenda que no está cargada».`);
    setSinCargar({ nombre: t, precio: "" });
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
  // Promo: la mejor de las de hoy (no se acumulan). El descuento especial la reemplaza. Al cobrar, el servidor recalcula todo.
  const promos = promosHoy.suc === sucursal ? promosHoy.promos : [];
  const itemsPromo = lineas.map((l) => ({ tipo: l.producto.tipo, precio: l.producto.precio, cant: l.cant }));
  const auto = mejorPromo(promos, itemsPromo);
  const descuento = especial ? descuentoEspecial(subtotal, especial.pct) : auto.descuento;
  const nombrePromo = especial ? `Descuento especial (${especial.pct}%)` : auto.promo ? `Promo ${auto.promo.nombre}` : "";
  const neto = subtotal - descuento;
  const sugerencia = !especial && lineas.length > 0 ? sugerenciaPromo(promos, itemsPromo, auto.descuento) : null;
  // Si la promo que se aplica no lleva el descuento de efectivo (feria, mayorista), los medios con descuento pasan a 0%: se paga el precio de la promo.
  // Productos unicos (efectivo cargado a mano): cada medio toma el % que da el carrito, igual que en el servidor.
  const sinDescEfvo = !especial && !!auto.promo && !auto.promo.descuentoEfectivo;
  const mediosVenta = sinDescEfvo ? mediosParaPromo(medios, auto.promo)
    : mediosDelCarrito(medios, lineas.map((l) => ({ precio: l.producto.precio, preciosMedio: l.producto.preciosMedio, cant: l.cant })));
  const promoAplicada = especial ? null : auto.promo;

  // Pagos: un solo medio (paga todo) o dos (el primero entrega un monto y el segundo paga lo que falta).
  const entrega1Num = parseInt(entrega1) || 0;
  // Nota de credito escaneada: entra como un primer pago (cubre lo que alcance) y el resto se paga con un medio normal.
  const notaMonto = nota && neto > 0 ? montoNotaAplicable(neto, nota.saldo, nota.ajustePct) : 0;
  const notaCubre = nota && notaMonto > 0 ? Math.round(notaMonto / (1 + nota.ajustePct / 100)) : 0;
  const restoLista = Math.max(0, neto - notaCubre);
  const medioNota: MedioPago | null = nota && notaMonto > 0 ? { id: `nota:${nota.codigo}`, nombre: `Nota de crédito ${nota.codigo}`, ajustePct: nota.ajustePct } : null;
  const pagosBase: PagoEntrada[] = mixto
    ? entrega1Num > 0 ? [{ medioId: pago1, monto: entrega1Num }, { medioId: pago2, monto: null }] : []
    : medioSel ? [{ medioId: medioSel, monto: null }] : [];
  const pagos: PagoEntrada[] = !medioNota ? pagosBase
    : restoLista === 0 ? [{ medioId: medioNota.id, monto: notaMonto }, { medioId: "transferencia", monto: null }]
    : pagosBase.length ? [{ medioId: medioNota.id, monto: notaMonto }, ...pagosBase] : [];
  const calc = pagos.length ? calcularPagos(neto, medioNota ? [...mediosVenta, medioNota] : mediosVenta, pagos) : null;
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
    const r = await cobrarVenta(sucursal, lineas.map((l) => ({ sku: l.producto.sku, cant: l.cant, origen: l.origen, faltante: l.faltante ?? null })), pagos, `${claveCobro.current}-${hashTexto(JSON.stringify([sucursal, lineas.map((l) => [l.producto.sku, l.cant, l.origen, l.faltante ?? null]), pagos, especial, calc.total]))}`, especial, calc.total);
    setCobrando(false);
    // Si fallo (por ejemplo, cambiaron las promos), se vuelven a pedir: la pantalla muestra el total nuevo.
    if (!r.ok) { setRecargaPromos((x) => x + 1); return setAviso(r.motivo); }
    claveCobro.current = crypto.randomUUID();
    if (nota && notaMonto > 0 && nota.saldo - notaMonto > 0) setSaldoNota({ codigo: nota.codigo, saldo: nota.saldo - notaMonto });
    setNota(null);
    setUltima({ ...r.venta, sucursal, recibido: pagoEfectivo && recibidoNum >= pagoEfectivo.monto ? recibidoNum : undefined });
    if (autoTicket) setAImprimir(true);
    setAviso("");
    setLineas(() => []);
    setEspecial(null);
    setFormEsp({ pct: "", motivo: "", autorizo: "" });
    setVerEsp(false);
    setMedioSel(null);
    setMixto(false);
    setEntrega1("");
    setRecibido("");
    setVersion((v) => v + 1);
  }

  useEffect(() => {
    if (!aImprimir) return;
    const t = setTimeout(() => {
      setAImprimir(false);
      if (ultima) imprimirTicketPreferido(() => ticketVentaEscpos(ultima)).then((m) => m && setAviso(m));
    }, 100);
    return () => clearTimeout(t);
  }, [aImprimir, ultima]);

  // Las notas de credito no son plata que entra a la caja: se muestran aparte y no suman al total cobrado.
  const filasCaja = caja.filas.filter((c) => c.id !== "nota_credito");
  const notasCaja = caja.filas.find((c) => c.id === "nota_credito");
  const totalCaja = filasCaja.reduce((s, c) => s + c.total, 0);
  const textoCobrar = !lineas.length ? "Cobrar"
    : !calc ? (mixto ? "Escribí cuánto entrega el cliente" : "Elegí cómo paga")
    : !calc.ok ? "Completá el pago"
    : `Cobrar ${pesos(calc.total)} · ${calc.pagos.map((p) => p.nombre).join(" + ")}`;

  function aplicarEspecial(e: React.FormEvent) {
    e.preventDefault();
    const pct = Number(formEsp.pct.replace(",", "."));
    if (!(pct >= 1 && pct <= TOPE_PCT)) return setErrEsp(`El descuento especial tiene que ser de 1% a ${TOPE_PCT}%`);
    if (formEsp.motivo.trim().length < 5) return setErrEsp("Escribí el motivo del descuento especial");
    if (formEsp.autorizo.trim().length < 2) return setErrEsp("Escribí quién lo autorizó");
    const d = descuentoEspecial(subtotal, pct);
    if (auto.promo && d <= auto.descuento) {
      return setErrEsp(`La promo ${textoPromo(auto.promo)} ya le descuenta ${pesos(auto.descuento)} y tu ${pct}% serían ${pesos(d)}: conviene dejar la promo.`);
    }
    setErrEsp("");
    setEspecial({ pct, motivo: formEsp.motivo.trim(), autorizo: formEsp.autorizo.trim() });
    setVerEsp(false);
  }

  return (
    <>
      <h1>Venta · {nombreSucursal(sucursal)}</h1>
      {promos.length > 0 && (
        <p className="alerta no-print" style={{ margin: "-4px 0 12px" }}>
          <strong>Promos de hoy:</strong> {promos.map((p) => `${descripcionPromo(p)} (hasta el ${p.hasta.slice(8, 10)}/${p.hasta.slice(5, 7)})`).join(" · ")}. Se aplican solas al escanear.
        </p>
      )}
      <div className="no-print" style={{ marginBottom: 12 }}>
        <form className="fila" onSubmit={(e) => { e.preventDefault(); confirmar(); }}>
          <input type="text" value={manual} autoComplete="off" autoFocus
            onChange={(e) => { setManual(e.target.value); setSel(-1); }} onKeyDown={teclaBuscador}
            placeholder="Escaneá una prenda, o escribí el nombre o el SKU" style={{ flex: 1, minWidth: 200 }} />
          <button type="submit">Agregar</button>
        </form>
        {!sinCargar ? (
          <button type="button" className="chico" style={{ marginTop: 6 }} onClick={() => { setSinCargar({ nombre: "", precio: "" }); setAviso(""); }}>Vender una prenda que no está cargada</button>
        ) : (
          <form className="fila tarjeta" style={{ gap: 8, marginTop: 8, flexWrap: "wrap", padding: 10 }} onSubmit={(e) => { e.preventDefault(); agregarSinCargar(); }}>
            <strong style={{ width: "100%" }}>Prenda que no está cargada</strong>
            <input type="text" value={sinCargar.nombre} autoFocus placeholder="Nombre (ej: remera basquet negra)" maxLength={120}
              onChange={(e) => setSinCargar({ ...sinCargar, nombre: e.target.value })} style={{ flex: 2, minWidth: 180 }} />
            <input type="number" inputMode="numeric" min={0} value={sinCargar.precio} placeholder="Precio de lista"
              onChange={(e) => setSinCargar({ ...sinCargar, precio: e.target.value })} style={{ flex: 1, minWidth: 120 }} />
            <button type="submit" className="principal">Agregar a la venta</button>
            <button type="button" className="chico" onClick={() => setSinCargar(null)}>Cancelar</button>
            <p className="aviso" style={{ width: "100%", margin: 0 }}>Se crea la prenda en el sistema (con código propio) y al cobrar se suma al stock de este local. Queda registrado para la oficina. El precio es el de lista (transferencia); efectivo y tarjeta se calculan como siempre.</p>
          </form>
        )}
        {lista.length > 0 && (
          <div className="sugerencias" role="listbox" aria-label="Prendas con stock en este local">
            {lista.map((p, i) => (
              <button key={p.sku} role="option" aria-selected={i === sel} className={i === sel ? "sel" : ""}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { agregarProducto(p); setManual(""); setSel(-1); }}>
                <span>{p.nombre} <small>· {p.sku}</small></span>
                <span><strong>{pesos(p.precio)}</strong> <small>{sucursal === DEPOSITO ? origenesDe(sucursal).map((o) => `${p.stock[o] ?? 0} en ${nombreSucursal(o)}`).join(" · ") : `${p.stock[sucursal] ?? 0} acá`}</small></span>
              </button>
            ))}
          </div>
        )}
      </div>
      {aviso && <p className="alerta mala no-print" role="alert" style={{ margin: "0 0 12px", fontSize: 16 }}>{aviso}</p>}
      {pregunta && (
        <div className="alerta no-print" role="alertdialog" style={{ margin: "0 0 12px", fontSize: 16, background: "#fff3c4", color: "#000", border: "1px solid #e0b100" }}>
          <strong>{pregunta.nombre}</strong> ({pesos(pregunta.precio)}): el sistema no tiene {lineas.some((l) => l.producto.sku === pregunta.sku) ? "más " : ""}en {origenesDe(sucursal).map(nombreSucursal).join(" ni en ")}. ¿La tenés igual acá?
          <div className="fila" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            {empresa.sucursales.filter((s) => !origenesDe(sucursal).includes(s.id) && (pregunta.stock[s.id] ?? 0) > 0).map((s) => (
              <button key={s.id} className="principal" onClick={() => elegirFaltante(pregunta, { modo: "traer", desde: s.id })}>
                Sí: el sistema la tiene en {s.nombre} ({pregunta.stock[s.id]}), pasarla acá
              </button>
            ))}
            <button className="principal" onClick={() => elegirFaltante(pregunta, { modo: "sin_cargar" })}>Sí: no estaba cargada, sumarla y vender</button>
            <button className="chico" onClick={() => setPregunta(null)}>No, cancelar</button>
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 13 }}>El stock se corrige al cobrar y queda registrado para la oficina (informe de control).</p>
        </div>
      )}
      {avisoOrigen && lineas.some((l) => l.origen !== sucursal) && <p className="alerta no-print" role="status" style={{ margin: "0 0 12px", fontSize: 15, background: "#fff3c4", color: "#000", border: "1px solid #e0b100" }}>{avisoOrigen}</p>}

      <div className="tarjeta no-print">
        {lineas.length === 0 ? (
          <p className="aviso">Escaneá una prenda para empezar. Solo se pueden vender prendas que están en {origenesDe(sucursal).map(nombreSucursal).join(" o ")}.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
          <table className="carrito">
            <thead><tr><th></th><th>Prenda</th><th className="der">Cantidad</th><th className="der">Precio de lista</th><th></th></tr></thead>
            <tbody>
              {lineas.map((f, idx) => (
                <tr key={claveLinea(f)} className={claveLinea(f) === ultimoSku ? "ultima" : ""}>
                  <td>{f.producto.foto && <img src={f.producto.foto} alt="" className="miniatura" />}</td>
                  <td>
                    <strong>{f.producto.nombre}</strong><br />
                    <span className="interno"><span className="mono">{f.producto.sku}</span> · {pesos(f.producto.precio)} c/u · hay {f.producto.stock[f.origen] ?? 0} {sucursal === DEPOSITO ? `en ${nombreSucursal(f.origen)}` : "acá"}</span>
                    {f.faltante && (
                      <><br /><strong style={{ background: "#fff3c4", color: "#000", padding: "1px 6px", borderRadius: 4, fontSize: 13 }}>
                        {f.faltante.modo === "traer" ? `Sin stock acá: al cobrar se pasa de ${nombreSucursal(f.faltante.desde)}` : "No estaba cargada: al cobrar se suma al stock"}
                      </strong></>
                    )}
                    {sucursal === DEPOSITO && (
                      <><br /><label className="fila" style={{ gap: 6, fontSize: 13, marginTop: 4, flexWrap: "wrap" }}>
                        <span>Sale del stock de:</span>
                        <select value={f.origen} disabled={!!f.faltante} onChange={(e) => cambiarOrigen(claveLinea(f), e.target.value)}
                          style={f.origen !== sucursal ? { background: "#fff3c4", color: "#000", fontWeight: 700 } : undefined}>
                          {origenesDe(sucursal).map((o) => <option key={o} value={o}>{nombreSucursal(o)} (hay {f.producto.stock[o] ?? 0})</option>)}
                        </select>
                      </label></>
                    )}
                    {promoAplicada && auto.detalle && auto.detalle.porItem[idx] > 0 && (
                      <><br /><strong className="vuelto-monto" style={{ fontSize: 14 }}>
                        {promoAplicada.tipo === "nxm" ? `${auto.detalle.gratis[idx] === 1 ? "1 GRATIS" : `${auto.detalle.gratis[idx]} GRATIS`} por ${textoPromo(promoAplicada)}`
                          : promoAplicada.tipo === "precio" ? `A ${pesos(promoAplicada.precio ?? 0)} c/u por promo` : `−${pesos(auto.detalle.porItem[idx])} por ${textoPromo(promoAplicada)}`}
                      </strong></>
                    )}
                    {promoAplicada?.sinCambio && auto.detalle?.entran[idx] && <><br /><strong className="sin-stock" style={{ fontSize: 13 }}>SIN CAMBIO</strong></>}
                  </td>
                  <td className="der" style={{ whiteSpace: "nowrap" }}>
                    <button className="chico" onClick={() => cambiarCantidad(claveLinea(f), -1)} disabled={f.cant <= 1} aria-label={`Una menos de ${f.producto.nombre}`}>−</button>
                    <span className="cantidad">{f.cant}</span>
                    <button className="chico" onClick={() => cambiarCantidad(claveLinea(f), 1)} aria-label={`Una más de ${f.producto.nombre}`}>+</button>
                  </td>
                  <td className="der"><strong>{pesos(f.producto.precio * f.cant)}</strong></td>
                  <td className="der"><button className="chico" onClick={() => setLineas((l) => l.filter((x) => claveLinea(x) !== claveLinea(f)))}>Quitar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        <div className="fila" style={{ justifyContent: "space-between", marginTop: 16 }}>
          <span className="aviso" style={{ fontSize: 16 }}>{cantidadTotal} {cantidadTotal === 1 ? "prenda" : "prendas"} · total a precio de lista</span>
          <span className={descuento > 0 ? "aviso" : "total-venta"} style={descuento > 0 ? { fontSize: 18, textDecoration: "line-through" } : undefined}>{pesos(subtotal)}</span>
        </div>
        {descuento > 0 && (
          <div className="vuelto" style={{ marginTop: 8 }}>
            <div className="fila" style={{ justifyContent: "space-between" }}>
              <span style={{ fontSize: 16 }}>
                <strong>{nombrePromo}</strong>{promoAplicada && <> · {descripcionPromo(promoAplicada)}</>}
                {especial && <> · <span className="interno">Motivo: {especial.motivo} · Autorizó: {especial.autorizo}</span> <button className="chico" onClick={() => setEspecial(null)}>Quitar</button></>}
              </span>
              <span className="total-venta">{pesos(neto)}</span>
            </div>
            <p style={{ margin: "4px 0 0", fontSize: 18 }}>Ahorra <strong className="vuelto-monto">{pesos(descuento)}</strong> <span className="aviso">· precio de lista {pesos(subtotal)} → con promo {pesos(neto)}</span></p>
            {promoAplicada && !promoAplicada.descuentoEfectivo && <p className="aviso" style={{ margin: "4px 0 0" }}>Esta promo tiene precio único: se paga {pesos(neto)} con cualquier medio (sin los descuentos por medio de pago).</p>}
          </div>
        )}
        {sugerencia && <p className="alerta" style={{ margin: "8px 0 0" }}>💡 {sugerencia.texto}</p>}

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
              {mediosVenta.map((m) => (
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
              {mediosVenta.map((m) => (
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
              {mediosVenta.filter((m) => m.id !== pago1).map((m) => (
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
                    Total a cobrar {pesos(calc.total)} · {calc.total === neto ? "sin ajuste" : `${calc.total > neto ? "recargo" : "descuento"} de ${pesos(Math.abs(calc.total - neto))} sobre ${descuento > 0 ? "el precio con la promo" : "el precio de lista"}`}
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

        {promosHoy.especial && lineas.length > 0 && !especial && (
          <div style={{ marginTop: 12 }}>
            {!verEsp ? (
              <button className="chico" onClick={() => setVerEsp(true)} style={{ opacity: 0.7 }}>Descuento especial (solo si lo consultaste)</button>
            ) : (
              <form className="vuelto" onSubmit={aplicarEspecial} style={{ display: "grid", gap: 8 }}>
                {errEsp && <p className="alerta mala" role="alert" style={{ margin: 0 }}>{errEsp}</p>}
                <strong>Descuento especial</strong>
                <span className="aviso">Solo si lo consultaste con la oficina. Reemplaza a la promo del día y queda registrado con tu usuario, el motivo y quién lo autorizó.</span>
                <div className="fila" style={{ gap: 8, flexWrap: "wrap" }}>
                  <input type="number" inputMode="decimal" min={1} max={TOPE_PCT} step={0.5} placeholder="%" value={formEsp.pct}
                    onChange={(e) => setFormEsp({ ...formEsp, pct: e.target.value })} onWheel={(e) => e.currentTarget.blur()} style={{ width: 90 }} required />
                  <input placeholder="Motivo (ej. clienta mayorista)" value={formEsp.motivo} maxLength={200}
                    onChange={(e) => setFormEsp({ ...formEsp, motivo: e.target.value })} style={{ flex: 2, minWidth: 200 }} required />
                  <input placeholder="¿Quién lo autorizó?" value={formEsp.autorizo} maxLength={60}
                    onChange={(e) => setFormEsp({ ...formEsp, autorizo: e.target.value })} style={{ flex: 1, minWidth: 150 }} required />
                </div>
                <div className="fila" style={{ gap: 8 }}>
                  <button type="submit">Aplicar descuento</button>
                  <button type="button" className="chico" onClick={() => { setVerEsp(false); setErrEsp(""); }}>Cancelar</button>
                </div>
              </form>
            )}
          </div>
        )}

        <button className="principal boton-cobrar" onClick={cobrar}
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
              {ultima.promo && <tr><td className="aviso">{ultima.promo.nombre}</td><td className="der">−{pesos(ultima.promo.monto)}</td></tr>}
              {ultima.pagos.map((p) => (
                <tr key={p.medioId}><td className="aviso">Pagó con {p.nombre}{p.medioId.startsWith("nota:") ? "" : ` (${etiquetaPct(p.pct)})`}{ultima.pagos.length > 1 ? `, cubre ${pesos(p.valorLista)} de lista` : ""}</td><td className="der">{pesos(p.monto)}</td></tr>
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

      <details className="no-print caja-hoy">
      <summary><strong>Caja de hoy · {nombreSucursal(sucursal)}</strong> <span className="aviso">· {caja.ventas} {caja.ventas === 1 ? "venta" : "ventas"} · {pesos(totalCaja)}</span></summary>
      <div className="tarjeta" style={{ marginTop: 8 }}>
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
      </details>
    </>
  );
}

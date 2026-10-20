"use server";
import * as repo from "@/lib/repo";
import { nombreSucursal, preciosDe, type Reparto } from "@/lib/util";
import type { DatosEtiqueta } from "@/components/Etiqueta";
import { imprimirEtiquetasEnServidor } from "@/lib/impresoraServidor";
import { auditar } from "@/lib/seguridad/auditoria";
import { conUsuario, type UsuarioSesion } from "@/lib/seguridad/contexto";
import { puede, sucursalFija, type Permiso } from "@/lib/seguridad/permisos";
import { ipDelPedido, usuarioActual } from "@/lib/seguridad/sesion";

// sesion:false = no hay sesion valida (la pantalla vuelve al login). cambiarClave = hay sesion pero falta elegir una contrasena propia.
type Ok<T> = ({ ok: true } & T) | { ok: false; motivo: string; sesion?: false; cambiarClave?: true };

// Toda accion del servidor pasa por aca: las Server Functions se pueden invocar por POST directo, no solo desde las
// pantallas, asi que SIEMPRE se verifica la sesion, el permiso del rol y (en `suc`) la sucursal. Esconder botones no alcanza.
async function seguro<T extends object>(permiso: Permiso, fn: (u: UsuarioSesion) => Promise<T>): Promise<Ok<T>> {
  // Si la base no responde, ni la sesion se puede verificar: se avisa claro en vez de romper la pantalla.
  const u = await usuarioActual().catch((e) => {
    console.error("[acciones] sin base:", e instanceof Error ? e.message : e);
    return undefined;
  });
  if (u === undefined) return { ok: false, motivo: "No hay conexión con el sistema. Revisá internet y probá de nuevo en unos segundos." };
  if (!u) return { ok: false, motivo: "Tu sesión venció. Volvé a iniciar sesión.", sesion: false };
  if (u.debeCambiarClave) return { ok: false, motivo: "Tenés que cambiar tu contraseña antes de seguir.", cambiarClave: true };
  const ip = await ipDelPedido();
  if (!puede(u.rol, permiso)) {
    await auditar("acceso_denegado", { permiso }, { usuarioId: u.id, email: u.email, ip }).catch(() => {});
    return { ok: false, motivo: "No tenés permiso para hacer esto." };
  }
  try {
    return { ok: true, ...(await conUsuario(u, ip, () => fn(u))) };
  } catch (e) {
    if (e instanceof repo.ErrorNegocio) return { ok: false, motivo: e.message };
    console.error("[acciones]", e);
    return { ok: false, motivo: "No se pudo completar la operación. Revisá la conexión e intentá de nuevo." };
  }
}

// Sucursal en la que se puede operar: el administrador elige; los demas quedan fijos en la suya (lo que mande el navegador no cuenta).
function suc(u: UsuarioSesion, pedida?: string) {
  const fija = sucursalFija(u.rol, u.sucursalId);
  if (fija === null) return pedida ?? "";
  if (!fija) throw new repo.ErrorNegocio("Tu usuario no tiene un local asignado. Pedile a un administrador que lo configure.");
  if (pedida && pedida !== fija) throw new repo.ErrorNegocio(`No tenés permiso para operar en ${nombreSucursal(pedida)}.`);
  return fija;
}

const txt = (v: unknown) => (typeof v === "string" ? v : "");
const ent = (v: unknown) => (typeof v === "number" ? v : Number(v));
const reparto = (r: unknown): Reparto => {
  const out: Reparto = {};
  if (r && typeof r === "object") for (const [k, v] of Object.entries(r)) out[k] = ent(v);
  return out;
};

// ---- Consulta ----
export async function buscarProductos(f: { q?: string; sucursalConStock?: string }) {
  return seguro("catalogo", async () => ({ productos: await repo.listar({ q: txt(f.q), sucursalConStock: f.sucursalConStock ? txt(f.sucursalConStock) : undefined }) }));
}

export async function sugerirProductos(q: string) {
  return seguro("catalogo", async () => ({ productos: txt(q).trim().length < 2 ? [] : await repo.listar({ q: txt(q), limite: 6 }) }));
}

export async function obtenerProducto(sku: string) {
  return seguro("catalogo", async () => {
    const producto = await repo.productoPorSku(txt(sku));
    if (!producto) throw new repo.ErrorNegocio(`No existe la prenda ${txt(sku).trim().toUpperCase()}`);
    return { producto };
  });
}

export async function obtenerTipos() {
  return seguro("catalogo", async () => ({ tipos: await repo.listarTipos() }));
}

export async function obtenerMediosPago() {
  return seguro("catalogo", async () => ({ medios: await repo.listarMediosPago() }));
}

export async function ingresosProducto(sku: string) {
  return seguro("catalogo", async () => ({ ingresos: await repo.ingresosDe(txt(sku)) }));
}

// ---- Carga y movimientos de mercaderia ----
export async function vistaPreviaCarga(a: { categoria: string; nombre: string; precio: number }) {
  return seguro("cargar", () => repo.vistaPrevia({ categoria: txt(a.categoria), nombre: txt(a.nombre), precio: ent(a.precio) || 0 }));
}

export async function cargarProducto(a: {
  categoria: string; nombre: string; precio: number; cantidad: number; foto?: string | null; reparto: Reparto;
}) {
  return seguro("cargar", async () => {
    // La foto solo puede ser una imagen embebida (data:image): nada de direcciones externas ni otros tipos de dato.
    if (a.foto && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]{20,}$/.test(txt(a.foto))) throw new repo.ErrorNegocio("La foto no es una imagen válida.");
    const producto = await repo.cargar({
      categoria: txt(a.categoria), nombre: txt(a.nombre), precio: ent(a.precio), cantidad: ent(a.cantidad),
      foto: a.foto ? txt(a.foto).slice(0, 60000) : null, reparto: reparto(a.reparto),
    });
    await auditar("carga", { sku: producto.sku, nombre: producto.nombre, precio: producto.precio, cantidad: ent(a.cantidad), reparto: reparto(a.reparto) });
    return { producto };
  });
}

export async function moverStock(sku: string, desde: string, r: Reparto) {
  return seguro("mover", async (u) => {
    const origen = suc(u, txt(desde));
    const producto = await repo.mover(txt(sku), origen, reparto(r));
    await auditar("envio", { sku: txt(sku), desde: origen, reparto: reparto(r) });
    return { producto };
  });
}

export async function ingresarProducto(sucursal: string, sku: string) {
  return seguro("recibir", async (u) => ({ recepcion: await repo.recibirPrenda(suc(u, txt(sucursal)), txt(sku)) }));
}

export async function deshacerIngresoLocal(sku: string, sucursal: string) {
  return seguro("deshacer_recepcion", async (u) => {
    const s = suc(u, txt(sucursal));
    await repo.deshacerRecepcion(txt(sku), s);
    await auditar("recepcion_deshecha", { sku: txt(sku), sucursal: s });
    return {};
  });
}

export async function obtenerPendientes(sucursal?: string) {
  return seguro("recibir", async (u) => {
    const s = suc(u, sucursal ? txt(sucursal) : undefined);
    return { traslados: await repo.listarPendientes(s || undefined) };
  });
}

export async function pendientesDe(sucursal: string) {
  return seguro("recibir", async (u) => ({ pendientes: await repo.contarPendientes(suc(u, txt(sucursal))) }));
}

export async function avisosEnvios(sucursal: string) {
  return seguro("recibir", async (u) => ({ avisos: await repo.avisosDe(suc(u, txt(sucursal))) }));
}

export async function recibirTodoElTraslado(id: number, sucursal: string) {
  return seguro("recibir", async (u) => ({ recepcion: await repo.recibirTraslado(ent(id), suc(u, txt(sucursal))) }));
}

export async function devolverEnvio(id: number) {
  return seguro("cancelar_envio", async () => {
    const devolucion = await repo.devolverTraslado(ent(id));
    await auditar("envio_cancelado", { traslado: ent(id), ...devolucion });
    return { devolucion };
  });
}

export async function totalSucursal(sucursal: string) {
  return seguro("ver_totales", async (u) => ({ total: await repo.totalEnSucursal(suc(u, txt(sucursal))) }));
}

export async function resumenDeSucursal(sucursal: string) {
  return seguro("ver_totales", async (u) => ({ resumen: await repo.resumenSucursal(suc(u, txt(sucursal))) }));
}

// ---- Ventas, devoluciones y notas de credito ----
export async function cobrarVenta(
  sucursal: string,
  items: { sku: string; cant: number }[],
  pagos: { medioId: string; monto: number | null }[],
  clave?: string,
) {
  return seguro("vender", async (u) => ({
    venta: await repo.registrarVenta(
      suc(u, txt(sucursal)),
      (Array.isArray(items) ? items : []).map((i) => ({ sku: txt(i.sku), cant: ent(i.cant) })),
      (Array.isArray(pagos) ? pagos : []).map((p) => ({ medioId: txt(p.medioId), monto: p.monto === null ? null : ent(p.monto) })),
      txt(clave).slice(0, 80) || undefined,
    ),
  }));
}

export async function cajaDeHoy(sucursal: string) {
  return seguro("vender", async (u) => ({ caja: await repo.ventasDeHoy(suc(u, txt(sucursal))) }));
}

export async function ventaParaDevolver(codigo: string) {
  return seguro("devolver", async (u) => ({ venta: await repo.ventaParaDevolucion(txt(codigo), sucursalFija(u.rol, u.sucursalId)) }));
}

export async function emitirNotaCredito(sucursal: string, ventaCodigo: string, items: { itemId: number; cant: number; falladas: number }[]) {
  return seguro("devolver", async (u) => {
    const nota = await repo.emitirNota(
      suc(u, txt(sucursal)), txt(ventaCodigo),
      (Array.isArray(items) ? items : []).map((i) => ({ itemId: ent(i.itemId), cant: ent(i.cant), falladas: ent(i.falladas) || 0 })),
      sucursalFija(u.rol, u.sucursalId),
    );
    await auditar("nota_emitida", { nota: nota.codigo, venta: nota.ventaCodigo, monto: nota.montoInicial, sucursal: nota.sucursal, items: nota.items });
    return { nota };
  });
}

export async function obtenerNota(codigo: string) {
  return seguro("vender", async () => ({ nota: await repo.notaPorCodigo(txt(codigo)) }));
}

// ---- Cambios sensibles (solo administrador): todos quedan en la auditoria con el valor anterior y el nuevo ----
export async function editarProducto(sku: string, a: { nombre: string; precio: number }) {
  return seguro("editar_producto", async () => {
    const antes = await repo.productoPorSku(txt(sku));
    const producto = await repo.editar(txt(sku), { nombre: txt(a.nombre), precio: ent(a.precio) });
    await auditar("producto_editado", { sku: txt(sku), antes: antes && { nombre: antes.nombre, precio: antes.precio }, despues: { nombre: producto.nombre, precio: producto.precio } });
    return { producto };
  });
}

export async function ajustarStockProducto(sku: string, sucursal: string, nueva: number, motivo: string) {
  return seguro("ajustar_stock", async () => {
    const antes = await repo.productoPorSku(txt(sku));
    const producto = await repo.ajustarStock(txt(sku), txt(sucursal), ent(nueva), txt(motivo));
    await auditar("stock_ajustado", { sku: txt(sku), sucursal: txt(sucursal), antes: antes?.stock[txt(sucursal)] ?? 0, despues: ent(nueva), motivo: txt(motivo) });
    return { producto };
  });
}

export async function eliminarProducto(sku: string) {
  return seguro("eliminar_producto", async () => {
    const antes = await repo.productoPorSku(txt(sku));
    await repo.eliminar(txt(sku));
    await auditar("producto_eliminado", { sku: txt(sku), nombre: antes?.nombre, precio: antes?.precio, stock: antes?.stock });
    return {};
  });
}

// ---- Impresion ----
// Reimprime etiquetas de una prenda que ya existe (se perdio o salio mal): NO toca el stock. El precio sale de la base, no de la pantalla.
export async function reimprimirEtiqueta(sku: string, cantidad: number) {
  return seguro("imprimir_etiquetas", async () => {
    const n = ent(cantidad);
    if (!(n >= 1 && n <= 100)) throw new repo.ErrorNegocio("Elegí entre 1 y 100 etiquetas.");
    const p = await repo.productoPorSku(txt(sku));
    if (!p) throw new repo.ErrorNegocio("No existe esa prenda.");
    const medios = await repo.listarMediosPago();
    const etiqueta = { sku: p.sku, nombre: p.nombre, precios: preciosDe(p.precio, medios) };
    await imprimirEtiquetasEnServidor(Array.from({ length: n }, () => etiqueta));
    await auditar("etiqueta_reimpresa", { sku: p.sku, nombre: p.nombre, precio: p.precio, cantidad: n });
    return { enviadas: n };
  });
}

export async function imprimirEtiquetasServidor(cola: DatosEtiqueta[]) {
  return seguro("imprimir_etiquetas", async () => {
    const limpia = (Array.isArray(cola) ? cola : []).slice(0, 500).map((e) => ({
      sku: txt(e?.sku).slice(0, 40),
      nombre: txt(e?.nombre).slice(0, 120),
      marco: !!e?.marco,
      precios: (Array.isArray(e?.precios) ? e.precios : []).slice(0, 4).map((p) => ({ nombre: txt(p?.nombre).slice(0, 30), valor: ent(p?.valor) || 0, ...(ent(p?.cuotas) > 0 ? { cuotas: Math.min(ent(p.cuotas), 24) } : {}) })),
    }));
    await imprimirEtiquetasEnServidor(limpia);
    return { enviadas: limpia.length };
  });
}

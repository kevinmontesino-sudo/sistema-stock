"use server";
import * as repo from "@/lib/repo";
import type { Reparto } from "@/lib/util";

type Ok<T> = ({ ok: true } & T) | { ok: false; motivo: string };

// TODO(login): antes de publicar la app, cada accion tiene que verificar la sesion y el rol del usuario.
// Las Server Functions se pueden invocar por POST directo, no solo desde las pantallas.
async function seguro<T extends object>(fn: () => Promise<T>): Promise<Ok<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    if (e instanceof repo.ErrorNegocio) return { ok: false, motivo: e.message };
    console.error("[acciones]", e);
    return { ok: false, motivo: "No se pudo completar la operación. Revisá la conexión e intentá de nuevo." };
  }
}

const txt = (v: unknown) => (typeof v === "string" ? v : "");
const ent = (v: unknown) => (typeof v === "number" ? v : Number(v));
const reparto = (r: unknown): Reparto => {
  const out: Reparto = {};
  if (r && typeof r === "object") for (const [k, v] of Object.entries(r)) out[k] = ent(v);
  return out;
};

export async function buscarProductos(f: { q?: string; sucursalConStock?: string }) {
  return seguro(async () => ({ productos: await repo.listar({ q: txt(f.q), sucursalConStock: f.sucursalConStock ? txt(f.sucursalConStock) : undefined }) }));
}

export async function sugerirProductos(q: string) {
  return seguro(async () => ({ productos: txt(q).trim().length < 2 ? [] : await repo.listar({ q: txt(q), limite: 6 }) }));
}

export async function obtenerProducto(sku: string) {
  return seguro(async () => {
    const producto = await repo.productoPorSku(txt(sku));
    if (!producto) throw new repo.ErrorNegocio(`No existe la prenda ${txt(sku).trim().toUpperCase()}`);
    return { producto };
  });
}

export async function obtenerTipos() {
  return seguro(async () => ({ tipos: await repo.listarTipos() }));
}

export async function vistaPreviaCarga(a: { categoria: string; nombre: string; precio: number }) {
  return seguro(() => repo.vistaPrevia({ categoria: txt(a.categoria), nombre: txt(a.nombre), precio: ent(a.precio) || 0 }));
}

export async function cargarProducto(a: {
  categoria: string; nombre: string; precio: number; cantidad: number; foto?: string | null; reparto: Reparto;
}) {
  return seguro(async () => ({
    producto: await repo.cargar({
      categoria: txt(a.categoria), nombre: txt(a.nombre), precio: ent(a.precio), cantidad: ent(a.cantidad),
      foto: a.foto ? txt(a.foto).slice(0, 60000) : null, reparto: reparto(a.reparto),
    }),
  }));
}

export async function moverStock(sku: string, desde: string, r: Reparto) {
  return seguro(async () => ({ producto: await repo.mover(txt(sku), txt(desde), reparto(r)) }));
}

export async function ingresarProducto(sucursal: string, sku: string) {
  return seguro(async () => ({ recepcion: await repo.recibirPrenda(txt(sucursal), txt(sku)) }));
}

export async function deshacerIngresoLocal(sku: string, sucursal: string) {
  return seguro(async () => {
    await repo.deshacerRecepcion(txt(sku), txt(sucursal));
    return {};
  });
}

export async function obtenerPendientes(sucursal?: string) {
  return seguro(async () => ({ traslados: await repo.listarPendientes(sucursal ? txt(sucursal) : undefined) }));
}

export async function pendientesDe(sucursal: string) {
  return seguro(async () => ({ pendientes: await repo.contarPendientes(txt(sucursal)) }));
}

export async function recibirTodoElTraslado(id: number, sucursal: string) {
  return seguro(async () => ({ recepcion: await repo.recibirTraslado(ent(id), txt(sucursal)) }));
}

export async function devolverEnvio(id: number) {
  return seguro(async () => ({ devolucion: await repo.devolverTraslado(ent(id)) }));
}

export async function totalSucursal(sucursal: string) {
  return seguro(async () => ({ total: await repo.totalEnSucursal(txt(sucursal)) }));
}

export async function cobrarVenta(
  sucursal: string,
  items: { sku: string; cant: number }[],
  pagos: { medioId: string; monto: number | null }[],
) {
  return seguro(async () => ({
    venta: await repo.registrarVenta(
      txt(sucursal),
      (Array.isArray(items) ? items : []).map((i) => ({ sku: txt(i.sku), cant: ent(i.cant) })),
      (Array.isArray(pagos) ? pagos : []).map((p) => ({ medioId: txt(p.medioId), monto: p.monto === null ? null : ent(p.monto) })),
    ),
  }));
}

export async function cajaDeHoy(sucursal: string) {
  return seguro(async () => ({ caja: await repo.ventasDeHoy(txt(sucursal)) }));
}

export async function editarProducto(sku: string, a: { nombre: string; precio: number }) {
  return seguro(async () => ({ producto: await repo.editar(txt(sku), { nombre: txt(a.nombre), precio: ent(a.precio) }) }));
}

export async function ajustarStockProducto(sku: string, sucursal: string, nueva: number, motivo: string) {
  return seguro(async () => ({ producto: await repo.ajustarStock(txt(sku), txt(sucursal), ent(nueva), txt(motivo)) }));
}

export async function eliminarProducto(sku: string) {
  return seguro(async () => {
    await repo.eliminar(txt(sku));
    return {};
  });
}


export async function obtenerMediosPago() {
  return seguro(async () => ({ medios: await repo.listarMediosPago() }));
}

export async function ingresosProducto(sku: string) {
  return seguro(async () => ({ ingresos: await repo.ingresosDe(txt(sku)) }));
}

export async function resumenDeSucursal(sucursal: string) {
  return seguro(async () => ({ resumen: await repo.resumenSucursal(txt(sucursal)) }));
}

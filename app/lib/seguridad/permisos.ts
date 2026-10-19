import { DEPOSITO } from "../empresa.config";

// Roles: admin (Kevin y Cesar), encargado (jefe de un local), vendedor (cajero de un local), deposito.
export type Rol = "admin" | "encargado" | "vendedor" | "deposito";
export const ROLES: Rol[] = ["admin", "encargado", "vendedor", "deposito"];
export const NOMBRE_ROL: Record<Rol, string> = { admin: "Administrador", encargado: "Encargado de local", vendedor: "Vendedor", deposito: "Depósito" };

// Que puede hacer cada rol. TODA accion del servidor pide uno de estos permisos: es el unico lugar para ajustarlos.
export type Permiso =
  | "catalogo" | "vender" | "recibir" | "devolver" | "deshacer_recepcion" | "cargar" | "imprimir_etiquetas"
  | "mover" | "cancelar_envio" | "ver_totales" | "remito" | "editar_producto" | "ajustar_stock" | "eliminar_producto" | "admin";

const TODOS: Rol[] = ["admin", "encargado", "vendedor", "deposito"];
export const PERMISOS: Record<Permiso, Rol[]> = {
  catalogo: TODOS,                                    // buscar prendas, precios y medios de pago
  vender: TODOS,                                      // cobrar, caja del dia, usar notas (el deposito tambien vende por telefono)
  recibir: TODOS,                                     // recibir envios en su sucursal
  devolver: ["admin", "encargado", "deposito"],       // emitir notas de credito (el vendedor solo las usa al cobrar)
  deshacer_recepcion: ["admin", "encargado"],
  cargar: ["admin", "deposito"],                      // cargar mercaderia nueva
  imprimir_etiquetas: ["admin", "deposito"],
  mover: ["admin", "deposito", "encargado"],          // enviar stock a otras sucursales
  cancelar_envio: ["admin", "deposito"],
  ver_totales: ["admin", "encargado", "deposito"],    // stock y totales de una sucursal
  remito: ["admin", "deposito", "encargado"],
  editar_producto: ["admin"],                         // cambiar nombre o precio
  ajustar_stock: ["admin"],
  eliminar_producto: ["admin"],
  admin: ["admin"],                                   // usuarios, auditoria, informes, promos
};

export const puede = (rol: Rol, permiso: Permiso) => PERMISOS[permiso].includes(rol);
export const permisosDe = (rol: Rol) => (Object.keys(PERMISOS) as Permiso[]).filter((p) => puede(rol, p));

// Sucursal en la que puede operar. El administrador elige cualquiera; los demas quedan fijos en la suya.
export function sucursalFija(rol: Rol, sucursalId: string | null): string | null {
  if (rol === "admin") return null;
  if (rol === "deposito") return DEPOSITO;
  return sucursalId;
}

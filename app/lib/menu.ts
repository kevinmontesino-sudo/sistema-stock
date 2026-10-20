import { puede, type Permiso, type Rol } from "./seguridad/permisos";

// El sistema se organiza en 3 momentos de la mercaderia (mas la oficina). Cada cuenta ve solo lo que puede usar,
// en el orden que mas le sirve. Es solo navegacion: los permisos los exige siempre el servidor.
export type ItemMenu = { href: string; texto: string; ayuda: string; permiso: Permiso };
export type Momento = { id: "cargar" | "distribuir" | "vender" | "oficina"; titulo: string; icono: string; items: ItemMenu[] };

export const MOMENTOS: Momento[] = [
  {
    id: "cargar", titulo: "Cargar", icono: "📦",
    items: [
      { href: "/carga", texto: "Cargar mercadería", ayuda: "Prendas nuevas y sus etiquetas", permiso: "cargar" },
      { href: "/buscar", texto: "Buscar prenda", ayuda: "Precio y stock de cada prenda", permiso: "catalogo" },
    ],
  },
  {
    id: "distribuir", titulo: "Distribuir", icono: "🚚",
    items: [
      { href: "/mover", texto: "Enviar", ayuda: "Mandar prendas a otro local", permiso: "mover" },
      { href: "/ingreso", texto: "Recibir", ayuda: "Confirmar lo que te mandaron", permiso: "recibir" },
      // Pantalla del deposito (stock guardado y envios que salieron de ahi): no es para los locales.
      { href: "/deposito", texto: "Stock y envíos", ayuda: "Lo que hay y lo que está en camino", permiso: "cancelar_envio" },
    ],
  },
  {
    id: "vender", titulo: "Vender", icono: "💵",
    items: [
      { href: "/venta", texto: "Venta", ayuda: "Escanear y cobrar", permiso: "vender" },
      { href: "/devolucion", texto: "Cambio o devolución", ayuda: "Nota de crédito con el ticket", permiso: "devolver" },
    ],
  },
  {
    id: "oficina", titulo: "Oficina", icono: "🏢",
    items: [
      { href: "/admin/informes", texto: "Informes", ayuda: "Ventas, prendas más vendidas, caja", permiso: "admin" },
      { href: "/admin/usuarios", texto: "Usuarios", ayuda: "Cuentas y contraseñas", permiso: "admin" },
      { href: "/admin/auditoria", texto: "Auditoría", ayuda: "Quién hizo qué", permiso: "admin" },
      { href: "/admin/accesos", texto: "Accesos API", ayuda: "Llaves para consultar informes", permiso: "admin" },
    ],
  },
];

// Un local arranca por vender; el deposito y la oficina, por cargar.
const ORDEN: Record<Rol, Momento["id"][]> = {
  admin: ["cargar", "distribuir", "vender", "oficina"],
  deposito: ["cargar", "distribuir", "vender", "oficina"],
  encargado: ["vender", "distribuir", "cargar", "oficina"],
  vendedor: ["vender", "distribuir", "cargar", "oficina"],
};

export function menuDe(rol: Rol, permisos?: Permiso[]): Momento[] {
  const tiene = (p: Permiso) => (permisos ? permisos.includes(p) : puede(rol, p));
  // Quien no carga mercaderia (un local) busca prendas mientras vende: "Buscar prenda" pasa a Vender.
  const carga = tiene("cargar");
  const items = (m: Momento) => [
    ...(m.id === "cargar" && !carga ? [] : m.items),
    ...(m.id === "vender" && !carga ? MOMENTOS[0].items.filter((i) => i.href === "/buscar") : []),
  ].filter((i) => tiene(i.permiso));
  return ORDEN[rol]
    .map((id) => MOMENTOS.find((m) => m.id === id)!)
    .map((m) => ({ ...m, items: items(m) }))
    .filter((m) => m.items.length > 0);
}

// Momento de la pantalla actual, dentro del menu de esa cuenta.
export function momentoDe(pathname: string, menu: Momento[] = MOMENTOS): Momento["id"] | null {
  for (const m of menu) if (m.items.some((i) => pathname === i.href || pathname.startsWith(i.href + "/"))) return m.id;
  return null;
}

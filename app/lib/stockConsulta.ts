import { empresa } from "./empresa.config";
import { ErrorNegocio, listar, listarMediosPago, listarTipos } from "./repo";
import { precioDeMedio, type Producto } from "./util";

// Consulta de stock y precios (SOLO LECTURA): la usan la API /api/stock (llave "stock") y el MCP remoto. Mismas reglas en los dos.
// Muestra unicamente: nombre, codigo, categoria, precio por medio de pago, foto y cantidad por local. Sin costos, ventas ni cajas.
export const LIMITE_MAX = 30;
// Los medios de pago que se le informan al cliente (los porcentajes se leen de la base: hoy transferencia = lista, efectivo -20%, tarjeta +20%).
const MEDIOS_CLIENTE = ["transferencia", "efectivo", "tarjeta"];
const sucursales = () => empresa.sucursales.map((s) => ({ id: s.id, nombre: s.nombre }));

export async function ayudaStock() {
  return {
    descripcion: "Consulta de stock y precios de X Menos Más Prendas (solo lectura, para responder a clientes).",
    uso: "GET /api/stock?q=<texto>&sucursal=<local>&categoria=<codigo>&limite=<1-30>&todos=1 (sin parámetros muestra esta ayuda). GET /api/stock?sku=<codigo> para una prenda.",
    parametros: {
      q: "Texto a buscar en el nombre o el código (ej. 'remera miche'). Un número de 4 o más cifras busca por precio de lista.",
      sku: "Código exacto de la prenda (ej. REM000001).",
      sucursal: `Solo prendas con stock en ese local. Locales: ${sucursales().map((s) => s.id).join(", ")}. Sin poner = todos.`,
      categoria: "Código de categoría (ver 'categorias' en la respuesta de esta ayuda).",
      limite: `Cantidad máxima de resultados (por defecto 10, máximo ${LIMITE_MAX}).`,
      todos: "Con todos=1 también aparecen las prendas sin stock. Por defecto solo las que hay.",
    },
    sucursales: sucursales(),
    categorias: (await listarTipos()).filter((x) => x.usos > 0).map((x) => ({ codigo: x.codigo, nombre: x.nombre })),
    precios: "Cada prenda trae el precio por medio de pago ya calculado (transferencia, efectivo y tarjeta). Las promos del día no están incluidas.",
    limites: "30 pedidos por minuto por llave.",
  };
}

export type ParamsStock = { q?: string | null; sku?: string | null; sucursal?: string | null; categoria?: string | null; limite?: string | number | null; todos?: string | boolean | null };
export async function consultarStock(p: ParamsStock) {
  const medios = await listarMediosPago();
  const texto = String(p.q ?? "").trim();
  const sku = String(p.sku ?? "").trim();
  const sucursal = String(p.sucursal ?? "").trim().toLowerCase();
  const categoria = String(p.categoria ?? "").trim().toUpperCase();
  if (texto.length > 80 || sku.length > 30) throw new ErrorNegocio("Búsqueda demasiado larga.");
  if (sucursal && !empresa.sucursales.some((s) => s.id === sucursal)) throw new ErrorNegocio(`Local inexistente. Locales: ${sucursales().map((s) => s.id).join(", ")}`);
  if (categoria && !(await listarTipos()).some((x) => x.codigo === categoria)) throw new ErrorNegocio("Categoría inexistente (ver la ayuda sin parámetros).");
  const limiteN = p.limite === null || p.limite === undefined || p.limite === "" ? 10 : Number(p.limite);
  if (!Number.isInteger(limiteN) || limiteN < 1) throw new ErrorNegocio(`limite tiene que ser un número entero de 1 a ${LIMITE_MAX}.`);
  const limite = Math.min(limiteN, LIMITE_MAX);
  const todos = p.todos === "1" || p.todos === true;
  // Se piden de mas porque despues se filtra por categoria y por stock, y recien ahi se recorta.
  const encontrados = await listar({ q: texto, sku: sku || undefined, sucursalConStock: sucursal || undefined, limite: 200 });
  const filas = encontrados
    .filter((x) => !categoria || x.tipo === categoria)
    .map((x) => aRespuesta(x, medios, sucursal))
    .filter((x) => todos || sku || x.disponible);
  return { cantidad: Math.min(filas.length, limite), hayMas: filas.length > limite, prendas: filas.slice(0, limite) };
}

function aRespuesta(p: Producto, medios: { id: string; nombre: string; ajustePct: number }[], sucursal: string) {
  const precios: Record<string, number> = {};
  for (const id of MEDIOS_CLIENTE) {
    const m = medios.find((x) => x.id === id);
    if (m) precios[id] = precioDeMedio({ precio: p.precio, preciosMedio: p.preciosMedio }, m);
  }
  const stock = Object.fromEntries(empresa.sucursales.map((s) => [s.id, Math.max(0, p.stock[s.id] ?? 0)]));
  const ver = sucursal ? { [sucursal]: stock[sucursal] } : stock;
  const disponible = Object.values(ver).some((n) => n > 0);
  const lugares = Object.entries(ver).filter(([, n]) => n > 0).map(([id, n]) => `${empresa.sucursales.find((s) => s.id === id)?.nombre}: ${n}`);
  return {
    sku: p.sku,
    nombre: p.nombre,
    categoria: p.tipo,
    precios,
    stock: ver,
    disponible,
    foto: p.foto,
    resumen: `${p.nombre} (${p.sku}) · ${Object.entries(precios).map(([id, v]) => `${id} $${v.toLocaleString("es-AR")}`).join(" · ")} · ${disponible ? `hay en ${lugares.join(", ")}` : "sin stock"}`,
  };
}

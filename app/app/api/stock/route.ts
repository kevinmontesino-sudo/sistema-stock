import { empresa } from "@/lib/empresa.config";
import { ErrorNegocio, listar, listarMediosPago, listarTipos } from "@/lib/repo";
import { permitirPedido, verificarToken } from "@/lib/seguridad/token";
import { precioDeMedio, type Producto } from "@/lib/util";

// API de STOCK para el asistente que contesta consultas de clientes (por ejemplo desde n8n). SOLO LECTURA.
// Solo la abre una llave de alcance "stock" (Oficina > Accesos API); esa llave no entra a informes, promos ni nada de ventas.
// Muestra unicamente: nombre, codigo, categoria, precio por medio de pago, foto y cantidad por local. No hay costos, ventas, cajas, clientes ni usuarios.
//   GET /api/stock?q=remera&sucursal=white&limite=10      (todos los parametros son opcionales)
//   GET /api/stock?sku=REM000001
// Encabezado: Authorization: Bearer xmp_...
const json = (cuerpo: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(cuerpo, null, 1), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra } });

const LIMITE_MAX = 30;

// Los medios de pago que se le informan al cliente (los porcentajes se leen de la base: hoy transferencia = lista, efectivo -20%, tarjeta +20%).
const MEDIOS_CLIENTE = ["transferencia", "efectivo", "tarjeta"];

export async function GET(req: Request) {
  const t = await verificarToken(req.headers.get("authorization"));
  if (!t) return json({ error: "Llave inválida, vencida o revocada." }, 401, { "WWW-Authenticate": "Bearer" });
  if (t.alcance !== "stock") return json({ error: "Esta llave no es de stock. Pedí una llave de alcance \"stock\" (Oficina > Accesos API)." }, 403);
  if (!permitirPedido(t.id)) return json({ error: "Demasiados pedidos: esperá un minuto." }, 429, { "Retry-After": "60" });

  const q = new URL(req.url).searchParams;
  const sucursales = empresa.sucursales.map((s) => ({ id: s.id, nombre: s.nombre }));
  try {
    const medios = await listarMediosPago();
    if (![...q.keys()].length) {
      return json({
        descripcion: "Consulta de stock y precios de X Menos Más Prendas (solo lectura, para responder a clientes).",
        uso: "GET /api/stock?q=<texto>&sucursal=<local>&categoria=<codigo>&limite=<1-30>&todos=1 (sin parámetros muestra esta ayuda). GET /api/stock?sku=<codigo> para una prenda.",
        parametros: {
          q: "Texto a buscar en el nombre o el código (ej. 'remera miche'). Un número de 4 o más cifras busca por precio de lista.",
          sku: "Código exacto de la prenda (ej. REM000001).",
          sucursal: `Solo prendas con stock en ese local. Locales: ${sucursales.map((s) => s.id).join(", ")}. Sin poner = todos.`,
          categoria: "Código de categoría (ver 'categorias' en la respuesta de esta ayuda).",
          limite: `Cantidad máxima de resultados (por defecto 10, máximo ${LIMITE_MAX}).`,
          todos: "Con todos=1 también aparecen las prendas sin stock. Por defecto solo las que hay.",
        },
        sucursales,
        categorias: (await listarTipos()).filter((x) => x.usos > 0).map((x) => ({ codigo: x.codigo, nombre: x.nombre })),
        precios: "Cada prenda trae el precio por medio de pago ya calculado (transferencia, efectivo y tarjeta). Las promos del día no están incluidas.",
        limites: "30 pedidos por minuto por llave.",
      });
    }

    const texto = (q.get("q") ?? "").trim();
    const sku = (q.get("sku") ?? "").trim();
    const sucursal = (q.get("sucursal") ?? "").trim().toLowerCase();
    const categoria = (q.get("categoria") ?? "").trim().toUpperCase();
    if (texto.length > 80 || sku.length > 30) return json({ error: "Búsqueda demasiado larga." }, 400);
    if (sucursal && !empresa.sucursales.some((s) => s.id === sucursal)) return json({ error: `Local inexistente. Locales: ${sucursales.map((s) => s.id).join(", ")}` }, 400);
    if (categoria && !(await listarTipos()).some((x) => x.codigo === categoria)) return json({ error: "Categoría inexistente (ver la ayuda sin parámetros)." }, 400);
    const limiteN = q.get("limite") === null ? 10 : Number(q.get("limite"));
    if (!Number.isInteger(limiteN) || limiteN < 1) return json({ error: `limite tiene que ser un número entero de 1 a ${LIMITE_MAX}.` }, 400);
    const limite = Math.min(limiteN, LIMITE_MAX);
    const todos = q.get("todos") === "1";

    // Se piden de mas porque despues se filtra por categoria y por stock, y recien ahi se recorta.
    const encontrados = await listar({ q: texto, sku: sku || undefined, sucursalConStock: sucursal || undefined, limite: 200 });
    const filas = encontrados
      .filter((p) => !categoria || p.tipo === categoria)
      .map((p) => aRespuesta(p, medios, sucursal))
      .filter((p) => todos || sku || p.disponible);
    return json({ cantidad: Math.min(filas.length, limite), hayMas: filas.length > limite, prendas: filas.slice(0, limite) });
  } catch (e) {
    if (e instanceof ErrorNegocio) return json({ error: e.message }, 400);
    console.error("[api/stock]", e);
    return json({ error: "No se pudo consultar el stock." }, 500);
  }
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

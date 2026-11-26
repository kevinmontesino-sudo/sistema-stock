import { ErrorNegocio } from "@/lib/repo";
import { permitirPedido, verificarToken } from "@/lib/seguridad/token";
import { ayudaStock, consultarStock } from "@/lib/stockConsulta";

// API de STOCK para el asistente que contesta consultas de clientes (por ejemplo desde n8n). SOLO LECTURA.
// Solo la abre una llave de alcance "stock" (Oficina > Accesos API); esa llave no entra a informes, promos ni nada de ventas.
// Muestra unicamente: nombre, codigo, categoria, precio por medio de pago, foto y cantidad por local. No hay costos, ventas, cajas, clientes ni usuarios.
// La logica vive en lib/stockConsulta.ts (la comparte el MCP remoto).
//   GET /api/stock?q=remera&sucursal=white&limite=10      (todos los parametros son opcionales)
//   GET /api/stock?sku=REM000001
// Encabezado: Authorization: Bearer xmp_...
const json = (cuerpo: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(cuerpo, null, 1), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra } });

export async function GET(req: Request) {
  const t = await verificarToken(req.headers.get("authorization"));
  if (!t) return json({ error: "Llave inválida, vencida o revocada." }, 401, { "WWW-Authenticate": "Bearer" });
  if (t.alcance !== "stock") return json({ error: "Esta llave no es de stock. Pedí una llave de alcance \"stock\" (Oficina > Accesos API)." }, 403);
  if (!permitirPedido(t.id)) return json({ error: "Demasiados pedidos: esperá un minuto." }, 429, { "Retry-After": "60" });
  const q = new URL(req.url).searchParams;
  try {
    if (![...q.keys()].length) return json(await ayudaStock());
    return json(await consultarStock({ q: q.get("q"), sku: q.get("sku"), sucursal: q.get("sucursal"), categoria: q.get("categoria"), limite: q.get("limite"), todos: q.get("todos") }));
  } catch (e) {
    if (e instanceof ErrorNegocio) return json({ error: e.message }, 400);
    console.error("[api/stock]", e);
    return json({ error: "No se pudo consultar el stock." }, 500);
  }
}

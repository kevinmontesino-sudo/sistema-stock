import { baseUrl, permitirPedidoMcp, verificarAcceso } from "@/lib/oauth";
import { CORS, jsonCors, opciones } from "@/lib/mcp/http";
import { procesarMcp } from "@/lib/mcp/servidor";
import { ipDelPedido } from "@/lib/seguridad/sesion";

// MCP remoto (transporte Streamable HTTP, sin sesion): Claude o ChatGPT mandan JSON-RPC por POST con el token del login OAuth.
// Sin token valido -> 401 con WWW-Authenticate (asi Claude sabe donde iniciar sesion). Solo administradores; 60 pedidos por minuto.
const noAutorizado = (base: string, error?: string) =>
  jsonCors({ error: error ?? "unauthorized", error_description: "Hace falta iniciar sesión (conector de X Menos Más Prendas)." }, 401, {
    "WWW-Authenticate": `Bearer realm="xmenosmasprendas", resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"${error ? `, error="${error}"` : ""}`,
  });

export async function POST(req: Request) {
  const base = baseUrl(req);
  const encabezado = req.headers.get("authorization");
  if (!encabezado) return noAutorizado(base);
  const acceso = await verificarAcceso(encabezado);
  if (!acceso) return noAutorizado(base, "invalid_token");
  if (!permitirPedidoMcp(acceso.conexionId)) return jsonCors({ error: "Demasiados pedidos: esperá un minuto." }, 429, { "Retry-After": "60" });
  const texto = await req.text();
  if (texto.length > 200_000) return jsonCors({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Pedido demasiado grande" } }, 413);
  let cuerpo: unknown;
  try { cuerpo = JSON.parse(texto); } catch { return jsonCors({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido" } }, 400); }
  const r = await procesarMcp(cuerpo, { usuario: acceso.usuario, cliente: acceso.cliente, ip: await ipDelPedido() });
  if (r === null) return new Response(null, { status: 202, headers: CORS });
  return jsonCors(r);
}

// Sin flujo de eventos (SSE) ni sesiones: el estandar permite contestar 405.
export function GET() {
  return new Response("Este conector solo acepta POST (MCP Streamable HTTP).", { status: 405, headers: { Allow: "POST, OPTIONS", ...CORS } });
}
export const DELETE = GET;
export const OPTIONS = opciones;

// Respuestas HTTP del MCP remoto y del login OAuth. Sin cookies: se puede abrir CORS (lo usan clientes que corren en un navegador).
export const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
  "Access-Control-Max-Age": "600",
};
export const jsonCors = (cuerpo: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS, ...extra } });
export const opciones = () => new Response(null, { status: 204, headers: CORS });

// Lee el cuerpo de /oauth/token y /oauth/revoke: formulario (lo que manda el estandar) o JSON (algunos clientes).
export async function leerFormulario(req: Request) {
  const texto = (await req.text()).slice(0, 10_000);
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      const o = JSON.parse(texto) as Record<string, unknown>;
      return new URLSearchParams(Object.entries(o).filter(([, v]) => typeof v === "string" || typeof v === "number").map(([k, v]) => [k, String(v)]));
    } catch { return new URLSearchParams(); }
  }
  return new URLSearchParams(texto);
}

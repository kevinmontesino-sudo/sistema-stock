import { ALCANCE, baseUrl, urlMcp } from "@/lib/oauth";
import { jsonCors, opciones } from "@/lib/mcp/http";

// Protected Resource Metadata (RFC 9728) del MCP remoto: le dice a Claude/ChatGPT donde iniciar sesion.
export function GET(req: Request) {
  const base = baseUrl(req);
  return jsonCors({ resource: urlMcp(base), authorization_servers: [base], scopes_supported: [ALCANCE], bearer_methods_supported: ["header"], resource_name: "X Menos Más Prendas" });
}
export const OPTIONS = opciones;

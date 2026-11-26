import { canjearCodigo, ErrorOAuth, refrescarToken } from "@/lib/oauth";
import { jsonCors, leerFormulario, opciones } from "@/lib/mcp/http";

// Canje de tokens (RFC 6749): codigo + PKCE -> tokens, o refresh -> tokens nuevos (rota). Errores con el formato estandar.
// Sin bloqueo por intentos: codigos y tokens son de 256 bits al azar (no se pueden adivinar) y Claude llama desde IP compartidas;
// un bloqueo por IP le serviria a un tercero para cortarnos la conexion.
export async function POST(req: Request) {
  try {
    const p = await leerFormulario(req);
    const tipo = p.get("grant_type");
    const t = tipo === "authorization_code" ? await canjearCodigo(p) : tipo === "refresh_token" ? await refrescarToken(p) : null;
    if (!t) return jsonCors({ error: "unsupported_grant_type", error_description: "Solo authorization_code y refresh_token." }, 400);
    return jsonCors(t, 200, { Pragma: "no-cache" });
  } catch (e) {
    if (e instanceof ErrorOAuth) return jsonCors({ error: e.codigo, error_description: e.message }, e.status);
    console.error("[oauth/token]", e);
    return jsonCors({ error: "server_error" }, 500);
  }
}
export const OPTIONS = opciones;

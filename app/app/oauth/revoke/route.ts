import { revocarToken } from "@/lib/oauth";
import { jsonCors, leerFormulario, opciones } from "@/lib/mcp/http";

// Revocacion (RFC 7009): la aplicacion pide desconectarse. Siempre responde 200 (no revela si el token existia).
export async function POST(req: Request) {
  try {
    const t = (await leerFormulario(req)).get("token");
    if (t) await revocarToken(t);
  } catch (e) {
    console.error("[oauth/revoke]", e);
  }
  return jsonCors({}, 200);
}
export const OPTIONS = opciones;

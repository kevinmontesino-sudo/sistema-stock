import { ErrorOAuth, registrarCliente } from "@/lib/oauth";
import { jsonCors, opciones } from "@/lib/mcp/http";

// Registro de la aplicacion (RFC 7591): Claude/ChatGPT se registran solos. Solo se aceptan direcciones de vuelta de Claude, ChatGPT o locales.
export async function POST(req: Request) {
  try {
    const texto = (await req.text()).slice(0, 10_000);
    let cuerpo: unknown = {};
    try { cuerpo = JSON.parse(texto || "{}"); } catch { throw new ErrorOAuth("invalid_client_metadata", "El cuerpo tiene que ser JSON."); }
    return jsonCors(await registrarCliente(cuerpo), 201);
  } catch (e) {
    if (e instanceof ErrorOAuth) return jsonCors({ error: e.codigo, error_description: e.message }, e.status);
    console.error("[oauth/register]", e);
    return jsonCors({ error: "server_error" }, 500);
  }
}
export const OPTIONS = opciones;

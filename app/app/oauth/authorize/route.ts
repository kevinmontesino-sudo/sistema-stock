import { baseUrl, ErrorOAuth, iniciarAutorizacion } from "@/lib/oauth";

// Inicio del login: valida el pedido de Claude/ChatGPT, lo guarda 10 minutos y manda a la pantalla /conectar (que pide iniciar sesion
// con la cuenta del sistema y muestra "Permitir / Cancelar"). Si el cliente o la direccion de vuelta no valen, muestra el error aca.
const pagina = (titulo: string, texto: string, status = 400) =>
  new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${titulo}</title><body style="font-family:system-ui;max-width:480px;margin:40px auto;padding:0 16px"><h1>${titulo}</h1><p>${texto}</p></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function GET(req: Request) {
  const base = baseUrl(req);
  try {
    const r = await iniciarAutorizacion(new URL(req.url).searchParams, base);
    const destino = r.tipo === "pedido" ? `${base}/conectar?p=${r.id}` : r.url;
    return new Response(null, { status: 302, headers: { Location: destino, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ErrorOAuth) return pagina("No se pudo conectar", escapar(e.message));
    console.error("[oauth/authorize]", e);
    return pagina("No se pudo conectar", "Error del sistema. Probá de nuevo en un momento.", 500);
  }
}

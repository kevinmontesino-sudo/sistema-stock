import { DEFINICIONES, TIPOS, esTipo, informe, validarParams } from "@/lib/informes";
import { ErrorNegocio } from "@/lib/repo";
import { auditar } from "@/lib/seguridad/auditoria";
import { ipDelPedido } from "@/lib/seguridad/sesion";
import { permitirPedido, verificarToken } from "@/lib/seguridad/token";

// API de informes: SOLO LECTURA, solo agregados (sin datos personales ni contrasenas), con llave (token) propia que vence y se puede revocar.
// Uso:  GET /api/informes?tipo=resumen&desde=2026-10-01&hasta=2026-10-31&sucursal=white   con   Authorization: Bearer xmp_...
const json = (cuerpo: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(cuerpo, null, 1), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra } });

export async function GET(req: Request) {
  const t = await verificarToken(req.headers.get("authorization"));
  if (!t) return json({ error: "Llave inválida, vencida o revocada." }, 401, { "WWW-Authenticate": "Bearer" });
  if (!permitirPedido(t.id)) return json({ error: "Demasiados pedidos: esperá un minuto." }, 429, { "Retry-After": "60" });

  const q = new URL(req.url).searchParams;
  const tipo = q.get("tipo");
  if (!tipo) {
    return json({
      descripcion: "API de informes de X Menos Más Prendas (solo lectura).",
      uso: "GET /api/informes?tipo=<tipo>&desde=AAAA-MM-DD&hasta=AAAA-MM-DD&sucursal=<opcional>&agrupar=dia|semana|mes&limite=<1-200>  con el encabezado Authorization: Bearer <llave>",
      sucursales: ["deposito", "zelarrayan", "white", "sanlorenzo"],
      tipos: { ...Object.fromEntries(Object.entries(TIPOS).map(([k, v]) => [k, v.descripcion])), panel: "Todos los informes juntos." },
      porDefecto: "Sin fechas: los últimos 30 días. Sin sucursal: todas.",
      limites: "Rango máximo 400 días. 30 pedidos por minuto por llave.",
      definiciones: DEFINICIONES,
    });
  }
  if (!esTipo(tipo)) return json({ error: `Tipo inexistente. Tipos: ${[...Object.keys(TIPOS), "panel"].join(", ")}` }, 400);
  try {
    const params = await validarParams({ desde: q.get("desde"), hasta: q.get("hasta"), sucursal: q.get("sucursal"), agrupar: q.get("agrupar"), limite: q.get("limite") });
    const datos = await informe(tipo, params);
    await auditar("api_informe", { llave: t.nombre, tipo, parametros: params }, { usuarioId: null, email: `llave:${t.nombre}`, ip: await ipDelPedido() }).catch(() => {});
    return json({ tipo, parametros: params, generado: new Date().toISOString(), definiciones: DEFINICIONES, datos });
  } catch (e) {
    if (e instanceof ErrorNegocio) return json({ error: e.message }, 400);
    console.error("[api/informes]", e);
    return json({ error: "No se pudo generar el informe." }, 500);
  }
}

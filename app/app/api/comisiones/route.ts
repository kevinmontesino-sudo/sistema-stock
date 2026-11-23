import { comisiones } from "@/lib/comisiones";
import { empresa } from "@/lib/empresa.config";
import { ErrorNegocio } from "@/lib/repo";
import { permitirPedido, verificarToken } from "@/lib/seguridad/token";

// API de COMISIONES: SOLO LECTURA. Cuanto lleva cada vendedor por semana (domingo a sabado) y quien va ganando el 1,5%.
// La abre una llave de alcance "informes" o "promos" (Oficina > Accesos API); la de "stock" no.
//   GET /api/comisiones?desde=2026-11-01&hasta=2026-11-30&ganador=sucursal|total
// Encabezado: Authorization: Bearer xmp_...
const json = (cuerpo: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(cuerpo, null, 1), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra } });

export async function GET(req: Request) {
  const t = await verificarToken(req.headers.get("authorization"));
  if (!t) return json({ error: "Llave inválida, vencida o revocada." }, 401, { "WWW-Authenticate": "Bearer" });
  if (t.alcance === "stock") return json({ error: "Esta llave es solo de stock: no puede consultar comisiones." }, 403);
  if (!permitirPedido(t.id)) return json({ error: "Demasiados pedidos: esperá un minuto." }, 429, { "Retry-After": "60" });
  const q = new URL(req.url).searchParams;
  try {
    const datos = await comisiones({ desde: q.get("desde"), hasta: q.get("hasta"), ganador: q.get("ganador") });
    return json({
      descripcion: "Comisiones por vendedor, por semana (domingo a sábado; la semana cierra el sábado).",
      reglas: `Cada vendedor cobra ${empresa.comision.pct}% de lo cobrado en la semana; el que más vendió de su sucursal (o del total con ganador=total) cobra ${empresa.comision.pctGanador}% en lugar del ${empresa.comision.pct}%. Base: lo cobrado sin ventas anuladas ni cortesías, menos las notas de crédito de la semana. Empate: ganan los dos. Ventas sin vendedor no comisionan.`,
      uso: "GET /api/comisiones?desde=AAAA-MM-DD&hasta=AAAA-MM-DD&ganador=sucursal|total (sin fechas: últimas 4 semanas; el rango se completa a semanas enteras; máximo 120 días).",
      sucursales: empresa.sucursales.map((s) => ({ id: s.id, nombre: s.nombre })),
      generado: new Date().toISOString(),
      ...datos,
    });
  } catch (e) {
    if (e instanceof ErrorNegocio) return json({ error: e.message }, 400);
    console.error("[api/comisiones]", e);
    return json({ error: "No se pudo calcular." }, 500);
  }
}

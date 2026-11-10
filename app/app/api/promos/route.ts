import { empresa } from "@/lib/empresa.config";
import { crearPromo, desactivarPromo, listarPromos } from "@/lib/promosAdmin";
import { TOPE_PCT } from "@/lib/promos";
import { ErrorNegocio, listarTipos } from "@/lib/repo";
import { auditar } from "@/lib/seguridad/auditoria";
import { ipDelPedido } from "@/lib/seguridad/sesion";
import { permitirPedido, verificarToken } from "@/lib/seguridad/token";

// API de PROMOS (por ejemplo para que Cesar le diga a su Claude "mañana y pasado 3x2 en White").
//   GET    /api/promos                 lista las promos (vigentes, programadas y pasadas) y cómo crearlas
//   POST   /api/promos   (JSON)        crea una promo           -> solo con llave de alcance "promos"
//   DELETE /api/promos?id=N            desactiva una promo      -> solo con llave de alcance "promos"
// Encabezado: Authorization: Bearer xmp_...   Cada cambio queda en la Auditoría.
const json = (cuerpo: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(cuerpo, null, 1), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra } });

async function llave(req: Request, escribe: boolean) {
  const t = await verificarToken(req.headers.get("authorization"));
  if (!t) return { error: json({ error: "Llave inválida, vencida o revocada." }, 401, { "WWW-Authenticate": "Bearer" }) };
  if (!permitirPedido(t.id)) return { error: json({ error: "Demasiados pedidos: esperá un minuto." }, 429, { "Retry-After": "60" }) };
  if (escribe && t.alcance !== "promos") return { error: json({ error: "Esta llave es solo de lectura: para crear o desactivar promos hace falta una llave de alcance \"promos\" (Oficina > Accesos API)." }, 403) };
  return { t };
}

const fallo = (e: unknown, donde: string) => {
  if (e instanceof ErrorNegocio) return json({ error: e.message }, 400);
  if (e instanceof SyntaxError) return json({ error: "El cuerpo tiene que ser JSON válido." }, 400);
  console.error(`[api/promos ${donde}]`, e);
  return json({ error: "No se pudo completar el pedido." }, 500);
};

export async function GET(req: Request) {
  const { t, error } = await llave(req, false);
  if (error) return error;
  try {
    const soloVigentes = new URL(req.url).searchParams.get("vigentes") === "1";
    return json({
      descripcion: "Promos de X Menos Más Prendas. Se aplican solas en la caja al escanear; nunca se acumulan (si hay varias, va la que más descuenta).",
      hoy: new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }),
      crear: {
        metodo: "POST /api/promos con JSON",
        campos: {
          tipo: '"nxm" (lleva n, paga m: las que no se pagan son las más baratas), "porcentaje" o "precio" (cada prenda a $precio: ferias "todo a $1.000", "buzos a $4.500", docena mayorista)',
          n: "nxm: cuántas lleva (2 a 10). 3x2 => n=3. precio: mínimo de prendas para que valga (ej. 12 = docena); sin poner = desde la primera",
          m: "nxm: cuántas paga (menor que n). 3x2 => m=2",
          pct: `porcentaje: descuento sobre el precio de lista (0,5 a ${TOPE_PCT})`,
          precio: "precio: pesos por prenda, sin centavos (si una prenda vale menos, queda a su precio)",
          descuento_efectivo: "opcional true/false: si además corren los descuentos por medio de pago (efectivo y transferencia; los porcentajes están en la base). Con false es precio único: la prenda se paga al precio de la promo con cualquier medio. Por defecto true en nxm y porcentaje, false en precio",
          sin_cambio: "opcional true/false (por defecto false): las prendas que entran en la promo quedan SIN CAMBIO (feria de saldos)",
          sucursales: `opcional, lista de: ${empresa.sucursales.map((s) => s.id).join(", ")}. Vacía o sin poner = todos los locales`,
          tipos: "opcional, códigos de categoría (ver 'categorias'). Vacía = todas las prendas",
          desde: "AAAA-MM-DD (hora de Argentina, incluido)", hasta: "AAAA-MM-DD (incluido). Máximo 3 meses",
          nombre: 'opcional, por ejemplo "3x2 fin de semana"',
        },
        ejemplos: [
          { tipo: "nxm", n: 3, m: 2, sucursales: ["white"], desde: "2026-11-06", hasta: "2026-11-07", nombre: "3x2" },
          { tipo: "precio", precio: 1000, sucursales: ["white"], desde: "2026-11-08", hasta: "2026-11-08", sin_cambio: true, nombre: "Feria todo a $1.000" },
          { tipo: "precio", precio: 4500, tipos: ["BUZ"], sucursales: ["sanlorenzo"], desde: "2026-11-08", hasta: "2026-11-09", nombre: "Feria de buzos" },
          { tipo: "precio", precio: 9690, n: 12, tipos: ["MAL"], desde: "2026-11-06", hasta: "2026-12-31", nombre: "Mallas por docena" },
        ],
      },
      desactivar: "DELETE /api/promos?id=N",
      permiso: t!.alcance === "promos" ? "Esta llave puede crear y desactivar promos." : "Esta llave es solo de lectura.",
      sucursales: empresa.sucursales.map((s) => ({ id: s.id, nombre: s.nombre })),
      categorias: (await listarTipos()).map((x) => ({ codigo: x.codigo, nombre: x.nombre })),
      promos: await listarPromos({ soloVigentes }),
    });
  } catch (e) {
    return fallo(e, "GET");
  }
}

export async function POST(req: Request) {
  const { t, error } = await llave(req, true);
  if (error) return error;
  try {
    if (Number(req.headers.get("content-length") || 0) > 5000) return json({ error: "Pedido demasiado grande." }, 413);
    const texto = await req.text();
    if (texto.length > 5000) return json({ error: "Pedido demasiado grande." }, 413);
    const datos = JSON.parse(texto || "{}");
    if (!datos || typeof datos !== "object" || Array.isArray(datos)) return json({ error: "Mandá un objeto JSON con la promo." }, 400);
    const promo = await crearPromo(datos, { usuarioId: null, origen: `api:${t!.nombre}` });
    await auditar("promo_creada", { promo, llave: t!.nombre }, { usuarioId: null, email: `llave:${t!.nombre}`, ip: await ipDelPedido() }).catch(() => {});
    return json({ ok: true, promo }, 201);
  } catch (e) {
    return fallo(e, "POST");
  }
}

export async function DELETE(req: Request) {
  const { t, error } = await llave(req, true);
  if (error) return error;
  try {
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id < 1) return json({ error: "Falta el id de la promo: DELETE /api/promos?id=N" }, 400);
    const r = await desactivarPromo(id);
    await auditar("promo_desactivada", { ...r, llave: t!.nombre }, { usuarioId: null, email: `llave:${t!.nombre}`, ip: await ipDelPedido() }).catch(() => {});
    return json({ ok: true, desactivada: r });
  } catch (e) {
    return fallo(e, "DELETE");
  }
}

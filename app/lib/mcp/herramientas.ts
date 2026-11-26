import { empresa } from "../empresa.config";
import { comisiones } from "../comisiones";
import { DEFINICIONES, TIPOS, esTipo, informe, validarParams } from "../informes";
import { crearPromo, desactivarPromo, listarPromos } from "../promosAdmin";
import { listarTipos } from "../repo";
import { auditar } from "../seguridad/auditoria";
import { consultarStock } from "../stockConsulta";

// Herramientas del MCP remoto (las mismas que el conector local app/scripts/mcp-informes.mjs). Llaman directo a la logica del sistema.
// NUNCA mueven plata: no hay cierres, retiros, caja fuerte ni ventas. Escriben solo promos, y solo un administrador (el login ya lo exige).
const SUCURSALES = empresa.sucursales.map((s) => s.id);
const TIPOS_INFORME = [...Object.keys(TIPOS), "panel"];
const hoyAR = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

export const HERRAMIENTAS = [
  {
    name: "estado_del_dia",
    title: "Cómo va el día",
    description: "Foto de HOY de todos los locales (solo lectura): control del dia (ventas, medios de pago, cierres de caja y diferencias, descuentos especiales, anulaciones, ajustes de stock, alertas) " +
      "y la caja fuerte (cuanto tendria que haber por local y lo guardado o retirado hoy). Usala para 'como va el dia' o 'como estan las cajas'. Opcional: una sola sucursal.",
    inputSchema: { type: "object", properties: { sucursal: { type: "string", enum: SUCURSALES, description: "Opcional." } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "consultar_informe",
    title: "Consultar un informe",
    description: "Informe de X Menos Mas Prendas (solo lectura). Tipos: resumen (ventas, total pagado, cobrado en caja, ticket promedio y medios de pago por sucursal), periodo (evolucion por dia/semana/mes), " +
      "prendas_mas_vendidas, prendas_menos_vendidas, notas_credito, stock (stock valorizado), horarios, ingresos (mercaderia cargada y enviada), control (control de UN dia: hasta=ese dia), cierres_caja, " +
      "caja_fuerte (cuanto tendria que haber por local, cada guardado de los cierres parciales y cada salida con responsable y destino, y los conteos), anulaciones (ventas anuladas con motivo y quien), " +
      "descuentos_cortesias (descuentos especiales y Curva Plus con quien autorizo, y cortesias), panel (todo junto). Fechas AAAA-MM-DD; sin fechas = ultimos 30 dias.",
    inputSchema: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: TIPOS_INFORME },
        desde: { type: "string", description: "AAAA-MM-DD (incluida)" },
        hasta: { type: "string", description: "AAAA-MM-DD (incluida)" },
        sucursal: { type: "string", enum: SUCURSALES, description: "Opcional: una sola sucursal." },
        agrupar: { type: "string", enum: ["dia", "semana", "mes"], description: "Solo para tipo periodo." },
        limite: { type: "integer", minimum: 1, maximum: 200, description: "Cantidad de prendas en los rankings (por defecto 20)." },
      },
      required: ["tipo"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "ver_comisiones",
    title: "Comisiones de vendedores",
    description: "Comisiones por vendedor y por semana (domingo a sabado) y quien va ganando el premio de la semana (solo lectura). Sin fechas: ultimas 4 semanas.",
    inputSchema: { type: "object", properties: { desde: { type: "string" }, hasta: { type: "string" }, ganador: { type: "string", enum: ["sucursal", "total"] } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "buscar_prenda",
    title: "Buscar una prenda",
    description: "Busca una prenda: stock en cada local y precio con cada medio de pago (solo lectura). Para 'hay jeans en White?' o 'cuanto sale la campera animal print'.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Texto a buscar en el nombre o codigo." },
        sku: { type: "string", description: "Codigo exacto." },
        sucursal: { type: "string", enum: SUCURSALES },
        categoria: { type: "string", description: "Codigo de categoria (ej. JEA)." },
        limite: { type: "integer", minimum: 1, maximum: 30 },
        todos: { type: "boolean", description: "true = tambien las que no tienen stock." },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "ver_catalogo",
    title: "Qué informes hay",
    description: "Lista los informes disponibles, sus parametros y las definiciones de cada numero.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "ver_promos",
    title: "Ver promos",
    description: "Lista las promos (vigentes, programadas y pasadas, con cuantas ventas las usaron), la fecha de hoy, las sucursales y los codigos de categoria. Usala antes de crear una promo.",
    inputSchema: { type: "object", properties: { solo_vigentes: { type: "boolean" } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "crear_promo",
    title: "Crear una promo",
    description: "Crea una promo en las cajas. Tipos: nxm (lleva n, paga m; 3x2 = n 3, m 2; no se pagan las mas baratas), porcentaje (sobre lista, hasta 50) o precio (cada prenda a $precio; " +
      "con n = minimo de prendas, ej. docena). Opcional: skus (solo esos productos) y manual=true (promo A MANO: no se aplica sola, el vendedor toca 'Aplicar' en la fila de la prenda, " +
      "ej. solo el talle 36; sirve para porcentaje, precio y nxm). Las promos no se acumulan. Preguntale al usuario si es SIN CAMBIO y si corre el descuento de efectivo. " +
      "Fechas AAAA-MM-DD de Argentina, ambas incluidas. Sin sucursales = todos los locales. ANTES de crearla, confirmale al usuario el resumen (tipo, locales, prendas, fechas, medios).",
    inputSchema: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["nxm", "porcentaje", "precio"] },
        n: { type: "integer", minimum: 2, maximum: 100 },
        m: { type: "integer", minimum: 1, maximum: 9 },
        pct: { type: "number", minimum: 0.5, maximum: 50 },
        precio: { type: "integer", minimum: 1 },
        descuento_efectivo: { type: "boolean", description: "false = precio unico con cualquier medio." },
        medios: { type: "array", items: { type: "string", enum: ["efectivo", "transferencia", "tarjeta"] } },
        sin_cambio: { type: "boolean" },
        sucursales: { type: "array", items: { type: "string", enum: SUCURSALES } },
        tipos: { type: "array", items: { type: "string" }, description: "Codigos de categoria (ver ver_promos)." },
        skus: { type: "array", items: { type: "string" } },
        manual: { type: "boolean" },
        desde: { type: "string" },
        hasta: { type: "string" },
        nombre: { type: "string" },
      },
      required: ["tipo", "desde", "hasta"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "desactivar_promo",
    title: "Desactivar una promo",
    description: "Desactiva una promo por su id (deja de aplicarse en las cajas en el momento). Confirmalo con el usuario antes.",
    inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
];

export type ContextoMcp = { usuario: { id: number; nombre: string; email: string }; cliente: string; ip: string | null };
type Args = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? v : v === undefined || v === null ? undefined : String(v));

async function paramsInforme(a: Args) {
  return validarParams({ desde: s(a.desde), hasta: s(a.hasta), sucursal: s(a.sucursal), agrupar: s(a.agrupar), limite: s(a.limite) });
}

// Ejecuta una herramienta y devuelve el resultado (objeto). Los errores de negocio se lanzan como ErrorNegocio (se muestran al usuario).
export async function ejecutarHerramienta(nombre: string, a: Args, ctx: ContextoMcp): Promise<unknown> {
  const quien = { usuarioId: ctx.usuario.id, email: ctx.usuario.email, ip: ctx.ip };
  const anotar = (accion: string, detalle: Record<string, unknown>) => auditar(accion, { ...detalle, via: `mcp:${ctx.cliente}` }, quien).catch(() => {});
  switch (nombre) {
    case "estado_del_dia": {
      const hoy = hoyAR();
      const pC = await validarParams({ hasta: hoy, sucursal: s(a.sucursal) });
      const pF = await validarParams({ desde: hoy, hasta: hoy, sucursal: s(a.sucursal) });
      const [control, cajaFuerte] = await Promise.all([informe("control", pC), informe("caja_fuerte", pF)]);
      await anotar("mcp_informe", { tipo: "estado_del_dia" });
      return { hoy, control, cajaFuerte };
    }
    case "consultar_informe": {
      const tipo = s(a.tipo) ?? "";
      if (!esTipo(tipo)) throw new Error(`tipo inválido. Opciones: ${TIPOS_INFORME.join(", ")}`);
      const p = await paramsInforme(a);
      const datos = await informe(tipo, p);
      await anotar("mcp_informe", { tipo, parametros: p });
      return { tipo, parametros: p, generado: new Date().toISOString(), definiciones: DEFINICIONES, datos };
    }
    case "ver_comisiones": {
      const r = await comisiones({ desde: s(a.desde), hasta: s(a.hasta), ganador: s(a.ganador) });
      await anotar("mcp_informe", { tipo: "comisiones" });
      return r;
    }
    case "buscar_prenda": {
      return consultarStock({ q: s(a.q), sku: s(a.sku), sucursal: s(a.sucursal), categoria: s(a.categoria), limite: a.limite === undefined ? undefined : Number(a.limite), todos: a.todos === true });
    }
    case "ver_catalogo":
      return { tipos: { ...Object.fromEntries(Object.entries(TIPOS).map(([k, v]) => [k, v.descripcion])), panel: "Todos los informes juntos." }, sucursales: SUCURSALES, definiciones: DEFINICIONES };
    case "ver_promos":
      return {
        hoy: hoyAR(),
        sucursales: empresa.sucursales.map((x) => ({ id: x.id, nombre: x.nombre })),
        categorias: (await listarTipos()).map((x) => ({ codigo: x.codigo, nombre: x.nombre })),
        promos: await listarPromos({ soloVigentes: a.solo_vigentes === true }),
      };
    case "crear_promo": {
      const datos = { ...a } as Parameters<typeof crearPromo>[0];
      const promo = await crearPromo(datos, { usuarioId: ctx.usuario.id, origen: `claude:${ctx.usuario.nombre}`.slice(0, 80) });
      await anotar("promo_creada", { promo });
      return { ok: true, promo };
    }
    case "desactivar_promo": {
      const id = Number(a.id);
      if (!Number.isInteger(id) || id < 1) throw new Error("Falta el id de la promo.");
      const r = await desactivarPromo(id);
      await anotar("promo_desactivada", { ...r });
      return { ok: true, desactivada: r };
    }
    default:
      throw new Error(`Herramienta desconocida: ${nombre}`);
  }
}

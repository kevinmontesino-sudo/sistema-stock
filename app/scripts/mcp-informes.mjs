#!/usr/bin/env node
// Conector (MCP) v2 de X Menos Mas Prendas para Claude. Herramientas:
//   SOLO LECTURA (llave de informes o promos): consultar_informe (ventas, prendas, stock, control diario, cierres de caja, CAJA FUERTE, anulaciones,
//   descuentos y cortesias), estado_del_dia (control de hoy + caja fuerte), ver_comisiones, ver_catalogo.
//   STOCK (llave "stock", opcional): buscar_prenda (stock y precios por local).
//   ESCRITURA ACOTADA (llave de alcance "promos"): ver_promos, crear_promo (incluye promos por producto y "a mano"), desactivar_promo.
// NUNCA mueve plata: no hay herramientas de cierre, retiros ni cajas. Cada herramienta usa la llave de su alcance y cada pedido queda en la Auditoria.
// Llama a la API del sistema con las llaves que se le dan por variable de entorno. No tiene dependencias: solo necesita Node 18 o mas.
//
// Variables:  SISTEMA_URL   (por ejemplo https://stock-caja-ventas.xmenosmasprendas.com)
//             SISTEMA_TOKEN (la llave "xmp_..." de informes o promos, que genera un administrador en Accesos API)
//             SISTEMA_TOKEN_STOCK (opcional: llave "Solo stock" para buscar_prenda; sin ella buscar_prenda no funciona)
// Ver INSTRUCCIONES_API_INFORMES.txt para configurarlo en Claude Desktop.
import { createInterface } from "node:readline";

const URL_BASE = (process.env.SISTEMA_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.SISTEMA_TOKEN || "";
const TOKEN_STOCK = process.env.SISTEMA_TOKEN_STOCK || "";
const TIPOS = ["resumen", "periodo", "prendas_mas_vendidas", "prendas_menos_vendidas", "notas_credito", "stock", "horarios", "ingresos", "control", "cierres_caja", "caja_fuerte", "anulaciones", "descuentos_cortesias", "panel"];

const herramientas = [
  {
    name: "consultar_informe",
    description:
      "Consulta un informe de ventas/stock de X Menos Mas Prendas (solo lectura). Tipos: resumen (ventas, total pagado, cobrado en caja, ticket promedio y medios de pago por sucursal), " +
      "periodo (evolucion por dia/semana/mes), prendas_mas_vendidas (ranking), prendas_menos_vendidas (rotacion), notas_credito (devoluciones y vales), stock (stock actual valorizado), " +
      "horarios (dias y horas de venta), ingresos (mercaderia cargada y enviada), control (informe de control de UN dia: poner hasta=ese dia; cierres de caja, diferencias y alertas, para imprimir), cierres_caja (cierres del periodo), caja_fuerte (cuanto tendria que haber por local, cada guardado de los cierres parciales y cada salida con responsable y destino, y los conteos), anulaciones (ventas anuladas con motivo y quien las anulo), descuentos_cortesias (descuentos especiales y Curva Plus con quien autorizo, y cortesias empresariales), panel (todo junto). Fechas en formato AAAA-MM-DD; sin fechas = ultimos 30 dias.",
    inputSchema: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: TIPOS, description: "Que informe pedir." },
        desde: { type: "string", description: "Fecha inicial AAAA-MM-DD (incluida)." },
        hasta: { type: "string", description: "Fecha final AAAA-MM-DD (incluida)." },
        sucursal: { type: "string", enum: ["deposito", "zelarrayan", "white", "sanlorenzo"], description: "Opcional: una sola sucursal." },
        agrupar: { type: "string", enum: ["dia", "semana", "mes"], description: "Solo para tipo periodo." },
        limite: { type: "integer", minimum: 1, maximum: 200, description: "Cantidad de prendas en los rankings (por defecto 20)." },
      },
      required: ["tipo"],
    },
  },
  {
    name: "estado_del_dia",
    description: "Foto de HOY de todos los locales en una sola consulta (solo lectura): informe de control del dia (ventas, medios de pago, cierres de caja y diferencias, descuentos especiales, anulaciones, ajustes de stock, alertas) " +
      "y la caja fuerte (cuanto tendria que haber por local y lo guardado o retirado hoy). Usala para 'como va el dia' o 'como estan las cajas'. Opcional: una sola sucursal.",
    inputSchema: { type: "object", properties: { sucursal: { type: "string", enum: ["deposito", "zelarrayan", "white", "sanlorenzo"], description: "Opcional." } } },
  },
  {
    name: "ver_comisiones",
    description: "Comisiones por vendedor y por semana (domingo a sabado), y quien va ganando el premio de la semana (solo lectura). Sin fechas: ultimas 4 semanas.",
    inputSchema: { type: "object", properties: { desde: { type: "string", description: "AAAA-MM-DD" }, hasta: { type: "string", description: "AAAA-MM-DD" }, ganador: { type: "string", enum: ["sucursal", "total"], description: "El premio va al que mas vendio de su sucursal o del total." } } },
  },
  {
    name: "buscar_prenda",
    description: "Busca una prenda y dice cuanto stock hay en cada local y a que precio sale con cada medio de pago (solo lectura; requiere la llave 'Solo stock' en SISTEMA_TOKEN_STOCK). " +
      "Usala para 'hay jeans en White?' o 'cuanto sale la campera animal print'. Sin costos ni ventas.",
    inputSchema: { type: "object", properties: {
      q: { type: "string", description: "Texto a buscar en el nombre (ej. campera animal print)." },
      sku: { type: "string", description: "Codigo exacto de la prenda." },
      sucursal: { type: "string", enum: ["deposito", "zelarrayan", "white", "sanlorenzo"], description: "Opcional: mirar solo un local." },
      categoria: { type: "string", description: "Opcional: categoria (ej. jean)." },
      limite: { type: "integer", minimum: 1, maximum: 30 },
    } },
  },
  { name: "ver_catalogo", description: "Lista los informes disponibles, sus parametros y las definiciones de cada numero.", inputSchema: { type: "object", properties: {} } },
  {
    name: "ver_promos",
    description: "Lista las promos de los locales (vigentes, programadas y pasadas, con cuantas ventas las usaron), la fecha de hoy, las sucursales y los codigos de categoria. " +
      "Usala antes de crear una promo para no repetirla y para saber que fecha es hoy.",
    inputSchema: { type: "object", properties: { solo_vigentes: { type: "boolean", description: "true = solo las que siguen activas (hoy o mas adelante)." } } },
  },
  {
    name: "crear_promo",
    description: "Crea una promo que se aplica SOLA en las cajas al escanear (requiere llave de alcance promos). Tipos: nxm (lleva n, paga m; ej. 3x2 = n 3, m 2: " +
      "no se pagan las prendas mas baratas), porcentaje (descuento sobre precio de lista, hasta 50) o precio (cada prenda a $precio: 'feria todo a $1.000' = precio 1000; " +
      "'buzos a $4.500 en San Lorenzo' = precio 4500, tipos con el codigo de buzos, sucursales [sanlorenzo]; 'mallas a $9.690 llevando la docena' = precio 9690, n 12). " +
      "Las promos no se acumulan: si hay varias va la que mas descuenta. Preguntale al usuario si es SIN CAMBIO (ferias de saldos) y si corre el descuento de efectivo " +
      "(por defecto si en nxm/porcentaje y no en precio). " +
      "Fechas AAAA-MM-DD de Argentina, ambas incluidas (\"mañana y pasado\" = desde mañana hasta pasado mañana). Sin sucursales = todos los locales. " +
      "Antes de crearla, confirmale al usuario el resumen (tipo, locales, prendas y fechas).",
    inputSchema: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["nxm", "porcentaje", "precio"] },
        n: { type: "integer", minimum: 2, maximum: 100, description: "nxm: cuantas lleva (2 a 10). precio: minimo de prendas para que valga (ej. 12 = docena)." },
        m: { type: "integer", minimum: 1, maximum: 9, description: "nxm: cuantas paga (menor que n)." },
        pct: { type: "number", minimum: 0.5, maximum: 50, description: "porcentaje: descuento." },
        precio: { type: "integer", minimum: 1, description: "precio: pesos por prenda." },
        descuento_efectivo: { type: "boolean", description: "Si ademas corren los descuentos por medio de pago (efectivo y transferencia). false = precio unico: se paga el precio de la promo con cualquier medio. Por defecto true en nxm/porcentaje, false en precio." },
        medios: { type: "array", items: { type: "string", enum: ["efectivo", "transferencia", "tarjeta"] }, description: "Medios de pago con los que vale la promo (tarjeta = credito). Solo vale si TODO el pago va con alguno de ellos. Vacio = cualquiera." },
        sin_cambio: { type: "boolean", description: "true = las prendas de la promo quedan SIN CAMBIO (feria de saldos)." },
        sucursales: { type: "array", items: { type: "string", enum: ["deposito", "zelarrayan", "white", "sanlorenzo"] }, description: "Locales donde vale. Vacio = todos." },
        tipos: { type: "array", items: { type: "string" }, description: "Codigos de categoria (ver ver_promos). Vacio = todas las prendas." },
        skus: { type: "array", items: { type: "string" }, description: "Opcional: codigos de prendas (SKU) a las que vale la promo; vacio = todas las de las categorias." },
        manual: { type: "boolean", description: "true = promo A MANO: no se aplica sola; en la caja sale un boton 'Aplicar' al lado de la prenda y el vendedor lo toca solo donde corresponde (ej. solo el talle 36, que el sistema no conoce). Puede ser porcentaje, precio o nxm (en nxm cuenta solo las prendas marcadas). Sin skus sale al lado de cualquier prenda." },
        desde: { type: "string", description: "AAAA-MM-DD" },
        hasta: { type: "string", description: "AAAA-MM-DD (maximo 3 meses despues de desde)" },
        nombre: { type: "string", description: "Opcional, ej. \"3x2 fin de semana\"." },
      },
      required: ["tipo", "desde", "hasta"],
    },
  },
  {
    name: "desactivar_promo",
    description: "Desactiva una promo por su id (deja de aplicarse en las cajas en el momento). Requiere llave de alcance promos.",
    inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
  },
];

async function llamarPromos(metodo, { query, cuerpo } = {}) {
  if (!URL_BASE || !TOKEN) throw new Error("Falta configurar SISTEMA_URL y SISTEMA_TOKEN.");
  const q = query ? "?" + new URLSearchParams(query) : "";
  const r = await fetch(`${URL_BASE}/api/promos${q}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(cuerpo ? { "Content-Type": "application/json" } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`La API respondio ${r.status}: ${texto.slice(0, 500)}`);
  return texto;
}

async function llamarGet(ruta, params, token, quePide) {
  if (!URL_BASE) throw new Error("Falta configurar SISTEMA_URL.");
  if (!token) throw new Error(`Falta la llave para ${quePide}.`);
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const r = await fetch(`${URL_BASE}${ruta}${q.size ? "?" + q : ""}`, { headers: { Authorization: `Bearer ${token}` } });
  const texto = await r.text();
  if (!r.ok) throw new Error(`La API respondio ${r.status}: ${texto.slice(0, 300)}`);
  return texto;
}

async function llamarApi(params) {
  if (!URL_BASE || !TOKEN) throw new Error("Falta configurar SISTEMA_URL y SISTEMA_TOKEN.");
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const r = await fetch(`${URL_BASE}/api/informes${q.size ? "?" + q : ""}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const texto = await r.text();
  if (!r.ok) throw new Error(`La API respondio ${r.status}: ${texto.slice(0, 300)}`);
  return texto;
}

const responder = (id, resultado) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result: resultado }) + "\n");
const fallar = (id, code, message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");

createInterface({ input: process.stdin }).on("line", async (linea) => {
  let m;
  try { m = JSON.parse(linea); } catch { return; }
  if (m.id === undefined) return; // notificaciones (por ejemplo "initialized"): no se responde
  try {
    if (m.method === "initialize") {
      return responder(m.id, { protocolVersion: m.params?.protocolVersion || "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "xmenosmasprendas-informes", version: "2.0.0" } });
    }
    if (m.method === "ping") return responder(m.id, {});
    if (m.method === "tools/list") return responder(m.id, { tools: herramientas });
    if (m.method === "tools/call") {
      const { name, arguments: a = {} } = m.params || {};
      try {
        if (name === "ver_catalogo") return responder(m.id, { content: [{ type: "text", text: await llamarApi({}) }] });
        if (name === "ver_promos") return responder(m.id, { content: [{ type: "text", text: await llamarPromos("GET", { query: a.solo_vigentes ? { vigentes: "1" } : undefined }) }] });
        if (name === "crear_promo") return responder(m.id, { content: [{ type: "text", text: await llamarPromos("POST", { cuerpo: a }) }] });
        if (name === "desactivar_promo") return responder(m.id, { content: [{ type: "text", text: await llamarPromos("DELETE", { query: { id: String(a.id) } }) }] });
        if (name === "estado_del_dia") {
          const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
          const [control, cajaFuerte] = await Promise.all([
            llamarApi({ tipo: "control", sucursal: a.sucursal }),
            llamarApi({ tipo: "caja_fuerte", desde: hoy, hasta: hoy, sucursal: a.sucursal }),
          ]);
          return responder(m.id, { content: [{ type: "text", text: `{"control": ${control}, "caja_fuerte": ${cajaFuerte}}` }] });
        }
        if (name === "ver_comisiones") return responder(m.id, { content: [{ type: "text", text: await llamarGet("/api/comisiones", a, TOKEN, "consultar comisiones (SISTEMA_TOKEN)") }] });
        if (name === "buscar_prenda") return responder(m.id, { content: [{ type: "text", text: await llamarGet("/api/stock", a, TOKEN_STOCK, "buscar prendas (SISTEMA_TOKEN_STOCK, llave 'Solo stock')") }] });
        if (name === "consultar_informe") {
          if (!TIPOS.includes(a.tipo)) throw new Error(`tipo invalido. Opciones: ${TIPOS.join(", ")}`);
          return responder(m.id, { content: [{ type: "text", text: await llamarApi(a) }] });
        }
        return fallar(m.id, -32602, `Herramienta desconocida: ${name}`);
      } catch (e) {
        return responder(m.id, { isError: true, content: [{ type: "text", text: String(e.message || e) }] });
      }
    }
    return fallar(m.id, -32601, `Metodo no soportado: ${m.method}`);
  } catch (e) {
    fallar(m.id, -32603, String(e.message || e));
  }
});

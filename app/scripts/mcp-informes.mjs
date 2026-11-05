#!/usr/bin/env node
// Conector (MCP) para que Claude consulte los INFORMES de X Menos Mas Prendas y, con una llave de alcance "promos", cree y
// desactive PROMOS (3x2, porcentajes) por local y fecha. Llama a la API del sistema con la llave que se le da por variable
// de entorno. No tiene dependencias: solo necesita Node 18 o mas.
//
// Variables:  SISTEMA_URL   (por ejemplo https://stock-caja-ventas.xmenosmasprendas.com)
//             SISTEMA_TOKEN (la llave "xmp_..." que genera un administrador en Accesos API)
// Ver INSTRUCCIONES_API_INFORMES.txt para configurarlo en Claude Desktop.
import { createInterface } from "node:readline";

const URL_BASE = (process.env.SISTEMA_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.SISTEMA_TOKEN || "";
const TIPOS = ["resumen", "periodo", "prendas_mas_vendidas", "prendas_menos_vendidas", "notas_credito", "stock", "horarios", "ingresos", "panel"];

const herramientas = [
  {
    name: "consultar_informe",
    description:
      "Consulta un informe de ventas/stock de X Menos Mas Prendas (solo lectura). Tipos: resumen (ventas, total pagado, cobrado en caja, ticket promedio y medios de pago por sucursal), " +
      "periodo (evolucion por dia/semana/mes), prendas_mas_vendidas (ranking), prendas_menos_vendidas (rotacion), notas_credito (devoluciones y vales), stock (stock actual valorizado), " +
      "horarios (dias y horas de venta), ingresos (mercaderia cargada y enviada), panel (todo junto). Fechas en formato AAAA-MM-DD; sin fechas = ultimos 30 dias.",
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
        descuento_efectivo: { type: "boolean", description: "Si ademas corre el -20% de efectivo. Por defecto true en nxm/porcentaje, false en precio." },
        sin_cambio: { type: "boolean", description: "true = las prendas de la promo quedan SIN CAMBIO (feria de saldos)." },
        sucursales: { type: "array", items: { type: "string", enum: ["deposito", "zelarrayan", "white", "sanlorenzo"] }, description: "Locales donde vale. Vacio = todos." },
        tipos: { type: "array", items: { type: "string" }, description: "Codigos de categoria (ver ver_promos). Vacio = todas las prendas." },
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
      return responder(m.id, { protocolVersion: m.params?.protocolVersion || "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "xmenosmasprendas-informes", version: "1.1.0" } });
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

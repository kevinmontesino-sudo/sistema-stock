#!/usr/bin/env node
// Conector (MCP) para que Claude consulte los INFORMES de X Menos Mas Prendas. Es solo lectura: llama a la API de informes
// con la llave que se le da por variable de entorno. No tiene dependencias: solo necesita Node 18 o mas.
//
// Variables:  SISTEMA_URL   (por ejemplo https://sistema-stock.xmenosmasprendas.com)
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
];

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
      return responder(m.id, { protocolVersion: m.params?.protocolVersion || "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "xmenosmasprendas-informes", version: "1.0.0" } });
    }
    if (m.method === "ping") return responder(m.id, {});
    if (m.method === "tools/list") return responder(m.id, { tools: herramientas });
    if (m.method === "tools/call") {
      const { name, arguments: a = {} } = m.params || {};
      try {
        if (name === "ver_catalogo") return responder(m.id, { content: [{ type: "text", text: await llamarApi({}) }] });
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

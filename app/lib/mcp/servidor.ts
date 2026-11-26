import { ErrorNegocio } from "../repo";
import { ejecutarHerramienta, HERRAMIENTAS, type ContextoMcp } from "./herramientas";

// Atiende los mensajes JSON-RPC del protocolo MCP (transporte "Streamable HTTP" sin sesion: cada POST trae uno o varios mensajes y
// se contesta con JSON). Solo herramientas: initialize, ping, tools/list, tools/call.
const VERSIONES = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCCIONES =
  "Sistema de stock y cajas de X Menos Mas Prendas (locales Zelarrayan, White, San Lorenzo y Deposito; Bahia Blanca, Argentina). " +
  "Montos en pesos argentinos; fechas de Argentina. Precio de lista = transferencia; efectivo -20%; tarjeta +20%. " +
  "Para 'como va el dia' usa estado_del_dia. Para numeros de un periodo usa consultar_informe. Nunca inventes numeros: si una herramienta falla, decilo. " +
  "Antes de crear o desactivar una promo, confirmale al usuario el resumen. Este conector no puede mover plata ni tocar cajas.";

type Msg = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
const ok = (id: Msg["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const err = (id: Msg["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function atender(m: Msg, ctx: ContextoMcp) {
  if (!m || typeof m !== "object" || m.jsonrpc !== "2.0" || typeof m.method !== "string") return err(m?.id, -32600, "Pedido inválido");
  if (m.id === undefined || m.id === null) return null; // notificacion (ej. notifications/initialized): no se contesta
  switch (m.method) {
    case "initialize": {
      const pedida = typeof m.params?.protocolVersion === "string" ? m.params.protocolVersion : "";
      return ok(m.id, {
        protocolVersion: VERSIONES.includes(pedida) ? pedida : VERSIONES[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "xmenosmasprendas", title: "X Menos Más Prendas", version: "2.0.0" },
        instructions: INSTRUCCIONES,
      });
    }
    case "ping":
      return ok(m.id, {});
    case "tools/list":
      return ok(m.id, { tools: HERRAMIENTAS });
    case "tools/call": {
      const nombre = typeof m.params?.name === "string" ? m.params.name : "";
      const args = (m.params?.arguments && typeof m.params.arguments === "object" ? m.params.arguments : {}) as Record<string, unknown>;
      if (!HERRAMIENTAS.some((h) => h.name === nombre)) return err(m.id, -32602, `Herramienta desconocida: ${nombre}`);
      try {
        const r = await ejecutarHerramienta(nombre, args, ctx);
        return ok(m.id, { content: [{ type: "text", text: JSON.stringify(r, null, 1) }], structuredContent: r && typeof r === "object" && !Array.isArray(r) ? r : { resultado: r } });
      } catch (e) {
        const msg = e instanceof ErrorNegocio || e instanceof Error ? e.message : "Error";
        if (!(e instanceof ErrorNegocio)) console.error("[mcp tools/call]", nombre, e);
        return ok(m.id, { isError: true, content: [{ type: "text", text: e instanceof ErrorNegocio ? msg : `No se pudo completar: ${msg.slice(0, 200)}` }] });
      }
    }
    default:
      return err(m.id, -32601, `Método no soportado: ${m.method}`);
  }
}

// Devuelve el cuerpo de la respuesta, o null si eran todas notificaciones (se contesta 202 sin cuerpo).
export async function procesarMcp(cuerpo: unknown, ctx: ContextoMcp) {
  if (Array.isArray(cuerpo)) {
    if (cuerpo.length === 0 || cuerpo.length > 20) return err(null, -32600, "Lote inválido");
    const rs = (await Promise.all(cuerpo.map((m) => atender(m as Msg, ctx)))).filter((x) => x !== null);
    return rs.length ? rs : null;
  }
  return atender(cuerpo as Msg, ctx);
}

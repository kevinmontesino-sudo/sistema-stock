import { empresa } from "./empresa.config";
import { trabajosTspl } from "./tspl";
import type { DatosEtiqueta } from "@/components/Etiqueta";

// Agente de impresion de esta PC (carpeta agente-impresion/): un programa chico que escucha en 127.0.0.1 y manda las etiquetas
// (TSPL) a la impresora sin ventana. Funciona igual en Windows y Mac, tambien con el sistema publicado.
export const URL_AGENTE = "http://127.0.0.1:9101";

// `targetAddressSpace` le avisa a Chrome que el destino es esta misma PC (pide permiso una vez y no lo bloquea por ser http desde una pagina https).
const opciones = { targetAddressSpace: "loopback" } as RequestInit;

export async function imprimirConAgente(cola: DatosEtiqueta[]) {
  let r: Response;
  try {
    r = await fetch(`${URL_AGENTE}/imprimir`, {
      ...opciones,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ impresora: empresa.impresoraEtiquetas, trabajos: trabajosTspl(cola) }),
    });
  } catch {
    throw new Error("No se encontró el agente de impresión en esta PC. Revisá que esté instalado y abierto (y que Chrome tenga permitido el acceso a la red local para este sitio).");
  }
  const datos = (await r.json().catch(() => ({}))) as { ok?: boolean; impresora?: string; error?: string };
  if (!r.ok || !datos.ok) throw new Error(datos.error || "El agente de impresión no pudo imprimir.");
  return datos.impresora ?? "la impresora";
}

// Ticket de venta o nota (ESC/POS): sin ventana ni tamano de hoja, y el corte sale justo. Si el agente no esta, falla y la pantalla
// ofrece imprimir con la ventana del navegador.
export async function imprimirTicketConAgente(bytes: Uint8Array) {
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  let r: Response;
  try {
    r = await fetch(`${URL_AGENTE}/imprimir-ticket`, {
      ...opciones,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ impresora: empresa.impresoraTickets, datos: btoa(binario) }),
    });
  } catch {
    throw new Error("No se encontró el agente de impresión en esta PC.");
  }
  const datos = (await r.json().catch(() => ({}))) as { ok?: boolean; impresora?: string; error?: string };
  if (!r.ok || !datos.ok) throw new Error(datos.error || "El agente de impresión no pudo imprimir el ticket.");
  return datos.impresora ?? "la impresora";
}

import { imprimirTicketConAgente } from "./agenteImpresion";
import { imprimir } from "./imprimir";
import { empresa } from "./empresa.config";

// Imprime un ticket por el agente (directo, sin ventana). Si el agente no esta o falla, cae a la ventana de impresion del navegador
// y devuelve un aviso para mostrar; "" si salio todo bien.
export async function imprimirTicketPreferido(construir: () => Promise<Uint8Array>) {
  try {
    await imprimirTicketConAgente(await construir());
    return "";
  } catch (e) {
    const motivo = e instanceof Error ? e.message : "No se pudo imprimir el ticket.";
    // Un momento para que React muestre el ticket en pantalla antes de abrir la ventana.
    setTimeout(() => imprimir(`${empresa.ticketMm.ancho}mm auto`), 100);
    return `${motivo} Se abrió la impresión del navegador.`;
  }
}

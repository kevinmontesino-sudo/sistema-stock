import { empresa } from "./empresa.config";

// Envia comandos directo a la impresora de etiquetas a traves de QZ Tray (programa gratuito que corre en esa PC).
export async function imprimirDirecto(trabajos: string[]) {
  const qz = (await import("qz-tray")).default;
  try {
    if (!qz.websocket.isActive()) await qz.websocket.connect({ retries: 0, delay: 1 });
  } catch {
    throw new Error("No se pudo conectar con QZ Tray. Instalalo (qz.io) y abrilo, o cambiá a la ventana del navegador.");
  }
  let impresora: string | string[];
  try {
    impresora = await qz.printers.find(empresa.impresoraEtiquetas);
  } catch {
    throw new Error(`QZ Tray no encontró ninguna impresora que contenga "${empresa.impresoraEtiquetas}" en el nombre.`);
  }
  const nombre = Array.isArray(impresora) ? impresora[0] : impresora;
  const config = qz.configs.create(nombre);
  await qz.print(config, trabajos.map((data) => ({ type: "raw", format: "command", flavor: "plain", data })));
  return nombre;
}

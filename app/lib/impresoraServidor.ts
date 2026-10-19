import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { empresa } from "./empresa.config";
import { etiquetasPdf } from "./etiquetaPdf";
import type { DatosEtiqueta } from "@/components/Etiqueta";

const exec = promisify(execFile);

// Imprime las etiquetas desde el servidor (la Mac/PC donde corre el sistema) con `lp`, sin ventana de impresion:
// tamano, orientacion y escala van fijos en el comando, asi no dependen de lo que se toque en el driver.
export async function imprimirEtiquetasEnServidor(cola: DatosEtiqueta[]) {
  if (cola.length === 0) return;
  const dir = await mkdtemp(join(tmpdir(), "etiquetas-"));
  try {
    const archivo = join(dir, "etiquetas.pdf");
    await writeFile(archivo, await etiquetasPdf(cola));
    const { servidor } = empresa;
    await exec("lp", ["-d", servidor.cola, "-o", `PageSize=${servidor.papel}`, "-o", "fit-to-page", "-o", "scaling=100", "-o", "orientation-requested=3", "-o", `Darkness=${servidor.oscuridad}`, "-o", "PrintSpeed=2", archivo], { timeout: 15000 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`No se pudo enviar a la impresora "${empresa.servidor.cola}": ${msg}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

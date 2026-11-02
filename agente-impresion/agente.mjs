// Agente de impresion de etiquetas. Corre en cada PC que tiene una impresora de etiquetas (Windows o Mac) y
// escucha SOLO en 127.0.0.1: la pagina del sistema le pasa las etiquetas (comandos TSPL) y el agente las manda
// a la impresora en crudo, sin ventana de impresion. No tiene dependencias: solo Node.
import http from "node:http";
import { execFile } from "node:child_process";
import { appendFile, mkdir, mkdtemp, rm, stat, truncate, writeFile } from "node:fs/promises";
import { homedir, platform, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const VERSION = "1.1.0";
const PUERTO = Number(process.env.AGENTE_PUERTO) || 9101;
const ORIGENES = (process.env.AGENTE_ORIGENES || "https://stock-caja-ventas.xmenosmasprendas.com,http://localhost:3000,http://127.0.0.1:3000")
  .split(",").map((s) => s.trim()).filter(Boolean);
const WINDOWS = platform() === "win32";
const AQUI = dirname(fileURLToPath(import.meta.url));
const CARPETA_LOG = join(homedir(), WINDOWS ? "AppData/Local/AgenteImpresion" : ".config/xmenosmas/agente-impresion");
const ARCHIVO_LOG = join(CARPETA_LOG, "agente.log");

async function log(texto) {
  const linea = `${new Date().toISOString()} ${texto}`;
  console.log(linea);
  try {
    await mkdir(CARPETA_LOG, { recursive: true });
    await appendFile(ARCHIVO_LOG, linea + "\n");
  } catch { /* el log es un extra: si falla no importa */ }
}

async function recortarLog() {
  try {
    if ((await stat(ARCHIVO_LOG)).size > 1_000_000) await truncate(ARCHIVO_LOG, 0);
  } catch { /* todavia no existe */ }
}

async function impresoras() {
  if (WINDOWS) {
    const { stdout } = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Printer | Select-Object -ExpandProperty Name"], { timeout: 20000, windowsHide: true });
    return stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  const { stdout } = await exec("lpstat", ["-e"], { timeout: 10000 });
  return stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

const normal = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// `consulta` puede traer varias opciones separadas por "|" (ej. "TM-T20|ticket": en Windows la impresora se llama de una forma y en Mac de otra).
async function buscarImpresora(consulta) {
  const lista = await impresoras();
  let nombre;
  for (const opcion of consulta.split("|")) {
    const q = normal(opcion);
    nombre = q ? lista.find((n) => normal(n).includes(q)) : undefined;
    if (nombre) break;
  }
  if (!nombre) throw new Error(`No hay ninguna impresora con "${consulta}" en el nombre. Impresoras de esta PC: ${lista.join(", ") || "ninguna"}.`);
  return nombre;
}

async function enviarCrudo(impresora, trabajos /* Buffer[] */) {
  const dir = await mkdtemp(join(tmpdir(), "etiquetas-"));
  try {
    let n = 0;
    for (const t of trabajos) {
      const archivo = join(dir, `trabajo${n++}.tspl`);
      await writeFile(archivo, t);
      if (WINDOWS) {
        await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(AQUI, "imprimir-raw.ps1"), "-Impresora", impresora, "-Archivo", archivo], { timeout: 30000, windowsHide: true });
      } else {
        await exec("lp", ["-d", impresora, "-o", "raw", archivo], { timeout: 15000 });
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Un trabajo a la vez: si llegan dos pedidos juntos no se mezclan las etiquetas.
let cola = Promise.resolve();
const enCola = (fn) => { const p = cola.then(fn, fn); cola = p.catch(() => {}); return p; };

function responder(res, codigo, cuerpo, extra = {}) {
  res.writeHead(codigo, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra });
  res.end(JSON.stringify(cuerpo));
}

function leerCuerpo(req, max = 8_000_000) {
  return new Promise((ok, mal) => {
    let tam = 0;
    const partes = [];
    req.on("data", (c) => {
      tam += c.length;
      if (tam > max) { mal(new Error("Pedido demasiado grande")); req.destroy(); return; }
      partes.push(c);
    });
    req.on("end", () => ok(Buffer.concat(partes).toString("utf8")));
    req.on("error", mal);
  });
}

const servidor = http.createServer(async (req, res) => {
  try {
    // Defensa contra "DNS rebinding": solo se atiende si el pedido vino dirigido a localhost.
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || "")) return responder(res, 403, { ok: false, error: "Host no permitido" });
    const origen = req.headers.origin;
    const permitido = !!origen && ORIGENES.includes(origen);
    const cors = permitido ? {
      "Access-Control-Allow-Origin": origen,
      "Vary": "Origin",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Private-Network": "true",
      "Access-Control-Max-Age": "600",
    } : {};
    if (req.method === "OPTIONS") { res.writeHead(permitido ? 204 : 403, cors); return res.end(); }
    const ruta = (req.url || "/").split("?")[0];

    // Pagina de diagnostico: se abre a mano en el navegador de esa PC (http://127.0.0.1:9101).
    if (req.method === "GET" && ruta === "/" && !origen) {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      let lista = "";
      try { lista = (await impresoras()).join("\n  "); } catch (e) { lista = `(no se pudo leer: ${e.message})`; }
      return res.end(`Agente de impresion de etiquetas v${VERSION}: funcionando.\nSistema: ${platform()}\nImpresoras de esta PC:\n  ${lista}\n`);
    }

    if (!permitido) return responder(res, 403, { ok: false, error: "Origen no permitido" });

    if (req.method === "GET" && ruta === "/estado") {
      let lista = [];
      try { lista = await impresoras(); } catch { /* se informa vacio */ }
      return responder(res, 200, { ok: true, version: VERSION, sistema: platform(), impresoras: lista }, cors);
    }

    if (req.method === "POST" && ruta === "/imprimir") {
      const datos = JSON.parse(await leerCuerpo(req) || "{}");
      const trabajos = datos.trabajos;
      const valido = Array.isArray(trabajos) && trabajos.length >= 1 && trabajos.length <= 500
        && trabajos.every((t) => typeof t === "string" && t.length < 40000 && t.startsWith("SIZE "));
      if (!valido) return responder(res, 400, { ok: false, error: "Trabajos de impresion invalidos" }, cors);
      if (typeof datos.impresora !== "string" || datos.impresora.length > 60) return responder(res, 400, { ok: false, error: "Impresora invalida" }, cors);
      const r = await enCola(async () => {
        const nombre = await buscarImpresora(datos.impresora);
        await enviarCrudo(nombre, trabajos.map((t) => Buffer.from(t, "latin1")));
        return nombre;
      });
      await log(`imprimio ${trabajos.length} trabajo(s) en "${r}" (desde ${origen})`);
      return responder(res, 200, { ok: true, impresora: r, trabajos: trabajos.length }, cors);
    }

    // Ticket en ESC/POS (impresora de rollo): llega en base64 y tiene que empezar con el reinicio de la impresora (ESC @).
    if (req.method === "POST" && ruta === "/imprimir-ticket") {
      const datos = JSON.parse(await leerCuerpo(req) || "{}");
      const bytes = typeof datos.datos === "string" ? Buffer.from(datos.datos, "base64") : Buffer.alloc(0);
      if (bytes.length < 4 || bytes.length > 3_000_000 || bytes[0] !== 0x1b || bytes[1] !== 0x40) return responder(res, 400, { ok: false, error: "Ticket invalido" }, cors);
      if (typeof datos.impresora !== "string" || datos.impresora.length > 60) return responder(res, 400, { ok: false, error: "Impresora invalida" }, cors);
      const r = await enCola(async () => {
        const nombre = await buscarImpresora(datos.impresora);
        await enviarCrudo(nombre, [bytes]);
        return nombre;
      });
      await log(`imprimio un ticket (${bytes.length} bytes) en "${r}" (desde ${origen})`);
      return responder(res, 200, { ok: true, impresora: r }, cors);
    }

    responder(res, 404, { ok: false, error: "No existe" }, cors);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await log(`error: ${msg}`);
    if (!res.headersSent) responder(res, 500, { ok: false, error: msg });
  }
});

servidor.on("error", async (e) => {
  if (e.code === "EADDRINUSE") { await log(`el puerto ${PUERTO} ya esta en uso (¿el agente ya esta abierto?). Salgo.`); process.exit(0); }
  await log(`error del servidor: ${e.message}`);
  process.exit(1);
});

await recortarLog();
servidor.listen(PUERTO, "127.0.0.1", () => log(`agente v${VERSION} escuchando en 127.0.0.1:${PUERTO} (${platform()})`));

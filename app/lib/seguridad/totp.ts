import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

// Doble verificacion (TOTP, RFC 6238): codigo de 6 digitos que cambia cada 30 segundos, compatible con
// Google Authenticator, Microsoft Authenticator, Authy, 1Password, etc.
const ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PASO = 30;

export function nuevoSecreto() {
  const b = randomBytes(20);
  let bits = "";
  for (const x of b) bits += x.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) out += ALFABETO[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function decodificar(s: string) {
  let bits = "";
  for (const c of s.replace(/=+$/, "").toUpperCase()) {
    const v = ALFABETO.indexOf(c);
    if (v < 0) throw new Error("Secreto invalido");
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function codigoTotp(secreto: string, paso: number) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(paso));
  const h = createHmac("sha1", decodificar(secreto)).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

export const pasoActual = (ahoraMs = Date.now()) => Math.floor(ahoraMs / 1000 / PASO);

// Devuelve el paso en el que coincidio (acepta 1 paso antes y 1 despues por diferencia de reloj) o null.
export function verificarTotp(secreto: string, codigo: string, ahoraMs = Date.now()): number | null {
  const limpio = codigo.replace(/\s/g, "");
  if (!/^\d{6}$/.test(limpio)) return null;
  const actual = pasoActual(ahoraMs);
  for (const d of [0, -1, 1]) if (codigoTotp(secreto, actual + d) === limpio) return actual + d;
  return null;
}

export const urlOtp = (secreto: string, email: string, emisor: string) =>
  `otpauth://totp/${encodeURIComponent(emisor)}:${encodeURIComponent(email)}?secret=${secreto}&issuer=${encodeURIComponent(emisor)}&algorithm=SHA1&digits=6&period=${PASO}`;

// El secreto se guarda cifrado (AES-256-GCM) con APP_KEY: si se filtra la base, no alcanza para saltear la doble verificacion.
function claveApp() {
  const k = process.env.APP_KEY ? Buffer.from(process.env.APP_KEY, "base64") : null;
  if (!k || k.length !== 32) throw new Error("Falta APP_KEY (32 bytes en base64) en las variables de entorno.");
  return k;
}
export function cifrar(texto: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", claveApp(), iv);
  const enc = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}
export function descifrar(guardado: string) {
  const [iv, tag, enc] = guardado.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", claveApp(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

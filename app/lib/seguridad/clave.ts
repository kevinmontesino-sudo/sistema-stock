import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Contrasenas con scrypt (memoria dificil de atacar con GPUs). Formato guardado: scrypt$N$r$p$sal$hash
const N = 32768;
const R = 8;
const P = 1;
const LARGO = 64;
const OPCIONES: ScryptOptions = { N, r: R, p: P, maxmem: 128 * N * R * 2 };

const derivar = (clave: string, sal: Buffer, n = N, r = R, p = P) =>
  new Promise<Buffer>((ok, mal) =>
    scrypt(clave.normalize("NFKC"), sal, LARGO, { ...OPCIONES, N: n, r, p, maxmem: 128 * n * r * 2 }, (e, k) => (e ? mal(e) : ok(k))),
  );

export async function hashClave(clave: string) {
  const sal = randomBytes(16);
  const h = await derivar(clave, sal);
  return `scrypt$${N}$${R}$${P}$${sal.toString("base64")}$${h.toString("base64")}`;
}

export async function verificarClave(clave: string, guardado: string) {
  const [alg, n, r, p, sal, h] = guardado.split("$");
  if (alg !== "scrypt" || !sal || !h) return false;
  const esperado = Buffer.from(h, "base64");
  const obtenido = await derivar(clave, Buffer.from(sal, "base64"), Number(n), Number(r), Number(p));
  return obtenido.length === esperado.length && timingSafeEqual(obtenido, esperado);
}

// Hash de relleno: cuando el usuario no existe igual se hace el calculo, asi no se nota por el tiempo de respuesta.
let relleno: Promise<string> | null = null;
export const hashDeRelleno = () => (relleno ??= hashClave(randomBytes(12).toString("hex")));

const COMUNES = new Set(["1234567890", "contrasena1", "password123", "qwertyuiop", "administrador", "xmenosmasprendas", "0123456789", "abcdefghij"]);
export function validarClaveNueva(clave: string, email: string): string | null {
  if (clave.length < 10) return "La contraseña tiene que tener al menos 10 caracteres.";
  if (clave.length > 128) return "La contraseña es demasiado larga.";
  const tipos = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(clave)).length;
  if (tipos < 3) return "Usá al menos 3 tipos de caracteres: minúsculas, mayúsculas, números y símbolos.";
  const baja = clave.toLowerCase();
  // Nada que se pueda adivinar sabiendo el nombre del negocio o del sistema.
  if (/masprendas|menosmas|xmenos|prendas|stock/.test(baja.replace(/[^a-z]/g, ""))) return "No uses el nombre del negocio ni del sistema en la contraseña: es lo primero que se prueba.";
  if (COMUNES.has(baja) || baja === email.toLowerCase() || baja.includes(email.split("@")[0].toLowerCase())) return "Esa contraseña es muy fácil de adivinar. Elegí otra.";
  return null;
}

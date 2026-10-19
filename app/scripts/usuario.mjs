// Administracion de usuarios desde la terminal (no depende de la pantalla). Uso:
//   npm run usuario -- listar
//   npm run usuario -- crear <email> "<Nombre>" <admin|encargado|vendedor|deposito> [sucursal]   (pide la contrasena sin mostrarla)
//   npm run usuario -- clave <email>             (nueva contrasena; obliga a cambiarla al entrar)
//   npm run usuario -- desbloquear <email>       (borra los intentos fallidos de login)
//   npm run usuario -- reset-2fa <email>         (reinicia la doble verificacion)
import { randomBytes, scrypt } from "node:crypto";
import { createInterface } from "node:readline";
import pg from "pg";

const N = 32768, R = 8, P = 1;
const hash = (clave) => new Promise((ok, mal) => {
  const sal = randomBytes(16);
  scrypt(clave.normalize("NFKC"), sal, 64, { N, r: R, p: P, maxmem: 128 * N * R * 2 }, (e, k) =>
    e ? mal(e) : ok(`scrypt$${N}$${R}$${P}$${sal.toString("base64")}$${k.toString("base64")}`));
});

function pedirClave(pregunta) {
  return new Promise((ok) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(pregunta)) process.stdout.write(s); };
    rl.question(pregunta, (r) => { rl.close(); process.stdout.write("\n"); ok(r); });
  });
}
function validar(clave, email) {
  if (clave.length < 10) return "Minimo 10 caracteres.";
  if ([/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(clave)).length < 3) return "Usa al menos 3 tipos: minusculas, mayusculas, numeros y simbolos.";
  if (clave.toLowerCase().includes(email.split("@")[0].toLowerCase())) return "No uses tu email en la contrasena.";
  return null;
}
async function claveNueva(email) {
  const a = await pedirClave("Contrasena nueva (no se muestra): ");
  const err = validar(a, email);
  if (err) throw new Error(err);
  if (a !== (await pedirClave("Repetila: "))) throw new Error("No coinciden.");
  return a;
}

const [cmd, ...args] = process.argv.slice(2);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  if (cmd === "listar") {
    const r = await pool.query("select email, nombre, rol, sucursal_id, activo, totp_activo from usuarios order by rol, email");
    console.table(r.rows);
  } else if (cmd === "crear") {
    const [email, nombre, rol, sucursal] = args;
    if (!email || !nombre || !["admin", "encargado", "vendedor", "deposito"].includes(rol)) throw new Error('Uso: crear <email> "<Nombre>" <admin|encargado|vendedor|deposito> [sucursal]');
    if ((rol === "encargado" || rol === "vendedor") && !sucursal) throw new Error("Falta la sucursal (zelarrayan, white o sanlorenzo).");
    const clave = await claveNueva(email);
    await pool.query("insert into usuarios (nombre, email, password_hash, rol, sucursal_id) values ($1, lower($2), $3, $4, $5)", [nombre, email, await hash(clave), rol, sucursal ?? null]);
    console.log(`Usuario creado: ${email} (${rol}).`);
  } else if (cmd === "clave") {
    const email = args[0];
    const clave = await claveNueva(email);
    const r = await pool.query("update usuarios set password_hash = $2, debe_cambiar_clave = false, clave_cambiada_en = now() where lower(email) = lower($1)", [email, await hash(clave)]);
    if (!r.rowCount) throw new Error("No existe ese usuario.");
    await pool.query("delete from sesiones where usuario_id = (select id from usuarios where lower(email) = lower($1))", [email]);
    console.log("Contrasena cambiada y sesiones cerradas.");
  } else if (cmd === "desbloquear") {
    const email = args[0].toLowerCase();
    const r = await pool.query("delete from intentos_login where email_norm = $1 or email_norm = 'totp:' || (select id::text from usuarios where lower(email) = $1)", [email]);
    console.log(`Listo: ${r.rowCount} intentos borrados.`);
  } else if (cmd === "reset-2fa") {
    const r = await pool.query("update usuarios set totp_secreto = null, totp_activo = false, totp_ultimo_paso = null where lower(email) = lower($1)", [args[0]]);
    if (!r.rowCount) throw new Error("No existe ese usuario.");
    await pool.query("delete from sesiones where usuario_id = (select id from usuarios where lower(email) = lower($1))", [args[0]]);
    console.log("Doble verificacion reiniciada.");
  } else {
    console.log("Comandos: listar | crear | clave | desbloquear | reset-2fa (ver el encabezado de scripts/usuario.mjs)");
  }
} catch (e) {
  console.error("Error:", e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { pool } from "./db";

// Login OAuth 2.0 (codigo + PKCE S256) para el MCP remoto: lo usan Claude (web, escritorio, celular, Claude Code) y ChatGPT para
// conectarse "como conector". Cada persona entra con SU cuenta del sistema y autoriza; SOLO administradores.
// Clientes publicos (sin secreto) registrados solos (RFC 7591), solo con direcciones de vuelta de Claude/ChatGPT o locales (loopback).
// De codigos y tokens solo se guarda la huella sha256. El refresh token rota en cada uso; si alguien reusa uno viejo se revoca la conexion.
export const ALCANCE = "stock";
const ACCESO_SEG = 60 * 60;            // token de acceso: 1 hora (Claude lo renueva solo)
const REFRESCO_SEG = 180 * 24 * 3600;  // token de refresco: 180 dias, se renueva en cada uso (si se usa, no vence nunca)
const CODIGO_SEG = 10 * 60;            // codigo y pedido de autorizacion: 10 minutos

const huella = (t: string) => createHash("sha256").update(t).digest("hex");
const azar = (n = 32) => randomBytes(n).toString("base64url");
const txt = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max + 1) : "");

export class ErrorOAuth extends Error {
  constructor(public codigo: string, mensaje: string, public status = 400) { super(mensaje); }
}

// Direccion publica del sistema (la que ve Claude). En produccion la arma con los encabezados del proxy (Easypanel); PUBLIC_URL la fija.
export function baseUrl(req: Request) {
  const fija = (process.env.PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
  if (fija) return fija;
  const h = req.headers;
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? new URL(req.url).host).split(",")[0].trim();
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim() || (local ? "http" : "https");
  return `${proto}://${host}`;
}
export const urlMcp = (base: string) => `${base}/mcp`;

// ---- Direcciones de vuelta permitidas ----
const DOMINIOS = ["claude.ai", "claude.com", "anthropic.com", "chatgpt.com", "chat.openai.com", "openai.com"];
const esLoopback = (u: URL) => u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]");
export function redirectPermitido(uri: string) {
  let u: URL;
  try { u = new URL(uri); } catch { return false; }
  if (u.hash || u.username || u.password || uri.length > 300) return false;
  if (esLoopback(u)) return true; // Claude Code y herramientas locales (RFC 8252)
  if (u.protocol !== "https:") return false;
  return DOMINIOS.some((d) => u.hostname === d || u.hostname.endsWith("." + d));
}
// Las direcciones locales (loopback) valen con cualquier puerto (RFC 8252 7.3); las demas, iguales letra por letra.
function mismoRedirect(registrado: string, pedido: string) {
  if (registrado === pedido) return true;
  try {
    const a = new URL(registrado), b = new URL(pedido);
    return esLoopback(a) && esLoopback(b) && a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search;
  } catch { return false; }
}

// ---- Registro de clientes (RFC 7591) ----
export async function registrarCliente(cuerpo: unknown) {
  const o = (cuerpo && typeof cuerpo === "object" && !Array.isArray(cuerpo) ? cuerpo : {}) as Record<string, unknown>;
  const uris = Array.isArray(o.redirect_uris) ? o.redirect_uris.filter((x): x is string => typeof x === "string") : [];
  if (uris.length === 0 || uris.length > 10) throw new ErrorOAuth("invalid_redirect_uri", "Faltan las direcciones de vuelta (redirect_uris).");
  for (const u of uris) if (!redirectPermitido(u)) throw new ErrorOAuth("invalid_redirect_uri", `Dirección de vuelta no permitida: ${u.slice(0, 120)}`);
  const recientes = await pool.query<{ n: number }>("select count(*)::int as n from oauth_clientes where creado_en > now() - interval '1 hour'");
  if (recientes.rows[0].n >= 60) throw new ErrorOAuth("temporarily_unavailable", "Demasiados registros: probá en un rato.", 429);
  const nombre = txt(o.client_name, 100).slice(0, 100) || "Aplicación";
  const clientId = "cli_" + azar(18);
  await pool.query("insert into oauth_clientes (client_id, nombre, redirect_uris) values ($1, $2, $3)", [clientId, nombre, uris]);
  return {
    client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: nombre, redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none", scope: ALCANCE,
  };
}

// ---- Autorizacion ----
// Valida el pedido de Claude y lo guarda (10 min). Si el cliente o la direccion de vuelta no valen, se muestra el error ACA (nunca se
// redirige a una direccion no registrada); el resto de los errores vuelve a la aplicacion como dice el estandar.
export type InicioAutorizacion = { tipo: "pedido"; id: string } | { tipo: "redirigir"; url: string };
export async function iniciarAutorizacion(q: URLSearchParams, base: string): Promise<InicioAutorizacion> {
  const clientId = txt(q.get("client_id"), 100);
  const cli = clientId ? (await pool.query<{ redirect_uris: string[] }>("select redirect_uris from oauth_clientes where client_id = $1", [clientId])).rows[0] : undefined;
  if (!cli) throw new ErrorOAuth("invalid_client", "La aplicación no está registrada. Volvé a agregar el conector desde Claude.");
  const pedida = txt(q.get("redirect_uri"), 300);
  const redirect = pedida || (cli.redirect_uris.length === 1 ? cli.redirect_uris[0] : "");
  if (!redirect || !cli.redirect_uris.some((r) => mismoRedirect(r, redirect))) throw new ErrorOAuth("invalid_request", "La dirección de vuelta no coincide con la registrada.");
  const state = q.get("state");
  const volver = (error: string, desc: string): InicioAutorizacion => {
    const u = new URL(redirect);
    u.searchParams.set("error", error);
    u.searchParams.set("error_description", desc);
    if (state) u.searchParams.set("state", state.slice(0, 500));
    return { tipo: "redirigir", url: u.toString() };
  };
  if (q.get("response_type") !== "code") return volver("unsupported_response_type", "Solo se admite response_type=code.");
  const challenge = txt(q.get("code_challenge"), 128);
  if (q.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) return volver("invalid_request", "PKCE con S256 es obligatorio.");
  if (state && state.length > 500) return volver("invalid_request", "state demasiado largo.");
  const resource = txt(q.get("resource"), 300);
  if (resource && resource.replace(/\/+$/, "") !== urlMcp(base) && resource.replace(/\/+$/, "") !== base) return volver("invalid_target", "Recurso desconocido.");
  const scope = txt(q.get("scope"), 200) || ALCANCE;
  await pool.query("delete from oauth_pedidos where vence_en < now() - interval '1 day'");
  await pool.query("delete from oauth_codigos where vence_en < now() - interval '1 day'");
  const id = azar(24);
  await pool.query(
    `insert into oauth_pedidos (id, client_id, redirect_uri, code_challenge, state, scope, resource, vence_en)
     values ($1, $2, $3, $4, $5, $6, $7, now() + ($8 || ' seconds')::interval)`,
    [id, clientId, redirect, challenge, state || null, scope, resource || null, String(CODIGO_SEG)]);
  return { tipo: "pedido", id };
}

export async function leerPedido(id: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(id)) return null;
  const r = await pool.query<{ cliente: string; redirect_uri: string }>(
    `select c.nombre as cliente, p.redirect_uri from oauth_pedidos p join oauth_clientes c on c.client_id = p.client_id where p.id = $1 and p.vence_en > now()`, [id]);
  if (!r.rows[0]) return null;
  return { cliente: r.rows[0].cliente, destino: new URL(r.rows[0].redirect_uri).hostname };
}

// La persona toco "Permitir": se consume el pedido (un solo uso) y se emite el codigo. Solo administradores.
export async function aprobarPedido(id: string, usuario: { id: number; rol: string }) {
  if (usuario.rol !== "admin") throw new ErrorOAuth("access_denied", "Solo un administrador puede conectar el sistema a Claude.", 403);
  const r = await pool.query<{ client_id: string; redirect_uri: string; code_challenge: string; state: string | null; scope: string | null }>(
    "delete from oauth_pedidos where id = $1 and vence_en > now() returning client_id, redirect_uri, code_challenge, state, scope", [id]);
  const p = r.rows[0];
  if (!p) throw new ErrorOAuth("invalid_request", "El pedido venció o ya se usó. Volvé a conectar desde Claude.");
  const codigo = azar(32);
  await pool.query(
    `insert into oauth_codigos (huella, client_id, usuario_id, redirect_uri, code_challenge, scope, vence_en)
     values ($1, $2, $3, $4, $5, $6, now() + ($7 || ' seconds')::interval)`,
    [huella(codigo), p.client_id, usuario.id, p.redirect_uri, p.code_challenge, p.scope, String(CODIGO_SEG)]);
  const u = new URL(p.redirect_uri);
  u.searchParams.set("code", codigo);
  if (p.state) u.searchParams.set("state", p.state);
  return u.toString();
}

export async function rechazarPedido(id: string) {
  const r = await pool.query<{ redirect_uri: string; state: string | null }>("delete from oauth_pedidos where id = $1 returning redirect_uri, state", [id]);
  if (!r.rows[0]) return null;
  const u = new URL(r.rows[0].redirect_uri);
  u.searchParams.set("error", "access_denied");
  u.searchParams.set("error_description", "La persona no autorizó la conexión.");
  if (r.rows[0].state) u.searchParams.set("state", r.rows[0].state);
  return u.toString();
}

// ---- Tokens ----
type Db = { query: typeof pool.query };
async function emitirTokens(db: Db, conexionId: number) {
  const acceso = "xmo_" + azar(32), refresco = "xmr_" + azar(32);
  await db.query(
    `insert into oauth_tokens (huella, conexion_id, tipo, vence_en) values
       ($1, $3, 'acceso', now() + ($4 || ' seconds')::interval), ($2, $3, 'refresco', now() + ($5 || ' seconds')::interval)`,
    [huella(acceso), huella(refresco), conexionId, String(ACCESO_SEG), String(REFRESCO_SEG)]);
  return { access_token: acceso, token_type: "Bearer", expires_in: ACCESO_SEG, refresh_token: refresco, scope: ALCANCE };
}

async function usuarioHabilitado(db: Db, usuarioId: number) {
  const r = await db.query<{ ok: boolean }>("select (activo and rol = 'admin') as ok from usuarios where id = $1", [usuarioId]);
  return !!r.rows[0]?.ok;
}

const iguales = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function canjearCodigo(p: URLSearchParams) {
  const codigo = txt(p.get("code"), 100), verificador = txt(p.get("code_verifier"), 128);
  const clientId = txt(p.get("client_id"), 100), redirect = txt(p.get("redirect_uri"), 300);
  if (!codigo || !verificador) throw new ErrorOAuth("invalid_request", "Faltan code o code_verifier.");
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verificador)) throw new ErrorOAuth("invalid_grant", "code_verifier inválido.");
  const c = await pool.connect();
  try {
    await c.query("begin");
    const r = await c.query<{ client_id: string; usuario_id: number; redirect_uri: string; code_challenge: string }>(
      `update oauth_codigos set usado_en = now() where huella = $1 and usado_en is null and vence_en > now()
       returning client_id, usuario_id::int as usuario_id, redirect_uri, code_challenge`, [huella(codigo)]);
    const k = r.rows[0];
    const desafio = createHash("sha256").update(verificador).digest("base64url");
    if (!k || (clientId && clientId !== k.client_id) || (redirect && !mismoRedirect(k.redirect_uri, redirect)) || !iguales(desafio, k.code_challenge)) {
      await c.query("commit"); // el codigo queda usado igual: un intento fallido lo quema
      throw new ErrorOAuth("invalid_grant", "El código no vale (vencido, ya usado o no coincide).");
    }
    if (!(await usuarioHabilitado(c, k.usuario_id))) { await c.query("commit"); throw new ErrorOAuth("invalid_grant", "El usuario no está habilitado."); }
    const cx = await c.query<{ id: number }>("insert into oauth_conexiones (client_id, usuario_id) values ($1, $2) returning id::int as id", [k.client_id, k.usuario_id]);
    const t = await emitirTokens(c, cx.rows[0].id);
    await c.query("commit");
    return t;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function refrescarToken(p: URLSearchParams) {
  const refresco = txt(p.get("refresh_token"), 100), clientId = txt(p.get("client_id"), 100);
  if (!refresco) throw new ErrorOAuth("invalid_request", "Falta refresh_token.");
  const c = await pool.connect();
  try {
    await c.query("begin");
    const r = await c.query<{ conexion_id: number; vencido: boolean; usado: boolean; client_id: string; usuario_id: number; revocada: boolean }>(
      `select t.conexion_id::int as conexion_id, t.vence_en <= now() as vencido, t.usado_en is not null as usado,
         x.client_id, x.usuario_id::int as usuario_id, x.revocado_en is not null as revocada
       from oauth_tokens t join oauth_conexiones x on x.id = t.conexion_id where t.huella = $1 and t.tipo = 'refresco' for update of t, x`, [huella(refresco)]);
    const t = r.rows[0];
    if (!t) { await c.query("commit"); throw new ErrorOAuth("invalid_grant", "El token de refresco no vale."); }
    if (t.usado) { // un refresh viejo reusado = posible robo: se corta la conexion entera
      await c.query("update oauth_conexiones set revocado_en = now(), motivo_revocacion = 'Token de refresco reutilizado (posible robo)' where id = $1 and revocado_en is null", [t.conexion_id]);
      await c.query("delete from oauth_tokens where conexion_id = $1", [t.conexion_id]);
      await c.query("commit");
      throw new ErrorOAuth("invalid_grant", "El token de refresco ya se había usado: por seguridad se cortó la conexión. Volvé a conectar.");
    }
    if (t.vencido || t.revocada || (clientId && clientId !== t.client_id) || !(await usuarioHabilitado(c, t.usuario_id))) {
      await c.query("commit");
      throw new ErrorOAuth("invalid_grant", "La conexión venció, fue revocada o el usuario no está habilitado. Volvé a conectar.");
    }
    await c.query("update oauth_tokens set usado_en = now() where huella = $1", [huella(refresco)]);
    await c.query("delete from oauth_tokens where conexion_id = $1 and vence_en < now()", [t.conexion_id]);
    const nuevo = await emitirTokens(c, t.conexion_id);
    await c.query("commit");
    return nuevo;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

// Revocacion pedida por la aplicacion (RFC 7009): un refresh corta la conexion; un acceso se borra. Siempre responde OK.
export async function revocarToken(token: string) {
  const h = huella(token.trim().slice(0, 100));
  const r = await pool.query<{ conexion_id: number; tipo: string }>("select conexion_id::int as conexion_id, tipo from oauth_tokens where huella = $1", [h]);
  const t = r.rows[0];
  if (!t) return;
  if (t.tipo === "refresco") await revocarConexion(t.conexion_id, null, "La aplicación pidió desconectarse");
  else await pool.query("delete from oauth_tokens where huella = $1", [h]);
}

// ---- Verificacion de cada pedido al MCP ----
export type AccesoMcp = { conexionId: number; cliente: string; usuario: { id: number; nombre: string; email: string; rol: string } };
export async function verificarAcceso(encabezado: string | null): Promise<AccesoMcp | null> {
  const m = encabezado?.match(/^Bearer\s+(\S+)$/i);
  const token = m?.[1];
  if (!token || !token.startsWith("xmo_") || token.length > 100) return null;
  const r = await pool.query<{ conexion_id: number; cliente: string; uid: number; nombre: string; email: string; rol: string }>(
    `select t.conexion_id::int as conexion_id, cl.nombre as cliente, u.id::int as uid, u.nombre, u.email, u.rol
     from oauth_tokens t join oauth_conexiones x on x.id = t.conexion_id join oauth_clientes cl on cl.client_id = x.client_id
       join usuarios u on u.id = x.usuario_id
     where t.huella = $1 and t.tipo = 'acceso' and t.vence_en > now() and x.revocado_en is null and u.activo and u.rol = 'admin'`, [huella(token)]);
  const f = r.rows[0];
  if (!f) return null;
  await pool.query("update oauth_conexiones set ultimo_uso = now(), usos = usos + 1 where id = $1", [f.conexion_id]);
  return { conexionId: f.conexion_id, cliente: f.cliente, usuario: { id: f.uid, nombre: f.nombre, email: f.email, rol: f.rol } };
}

// Limite de pedidos por conexion: 60 por minuto (en memoria; alcanza con una sola instancia de la app).
const ventanas = new Map<number, { desde: number; n: number }>();
export function permitirPedidoMcp(conexionId: number, ahora = Date.now()) {
  const v = ventanas.get(conexionId);
  if (!v || ahora - v.desde > 60_000) { ventanas.set(conexionId, { desde: ahora, n: 1 }); return true; }
  v.n++;
  return v.n <= 60;
}

// ---- Oficina > Accesos API ----
export async function listarConexiones() {
  const r = await pool.query<{ id: number; cliente: string; usuario: string; creado: Date; ultimo_uso: Date | null; usos: number; revocado: Date | null; motivo: string | null }>(
    `select x.id::int as id, cl.nombre as cliente, u.nombre as usuario, x.creado_en as creado, x.ultimo_uso, x.usos, x.revocado_en as revocado, x.motivo_revocacion as motivo
     from oauth_conexiones x join oauth_clientes cl on cl.client_id = x.client_id join usuarios u on u.id = x.usuario_id
     order by (x.revocado_en is null) desc, x.creado_en desc limit 100`);
  return r.rows.map((x) => ({ id: x.id, cliente: x.cliente, usuario: x.usuario, creado: x.creado.toISOString(), ultimoUso: x.ultimo_uso?.toISOString() ?? null, usos: x.usos, revocado: x.revocado?.toISOString() ?? null, motivo: x.motivo }));
}

export async function revocarConexion(id: number, porUsuarioId: number | null, motivo = "Revocada desde Oficina") {
  const r = await pool.query<{ id: number }>(
    "update oauth_conexiones set revocado_en = now(), revocado_por = $2, motivo_revocacion = $3 where id = $1 and revocado_en is null returning id::int as id",
    [id, porUsuarioId, motivo.slice(0, 200)]);
  await pool.query("delete from oauth_tokens where conexion_id = $1", [id]);
  return !!r.rows[0];
}

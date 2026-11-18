import { pool } from "./db";
import { ErrorNegocio } from "./repo";

// Conexion con el sistema de ficha (cuentas corrientes de empleados). El stock solo puede: listar empleados activos y CARGAR consumos.
// No puede ver saldos ni borrar: la llave que usa (FICHA_API_KEY) en la ficha solo sirve para eso.
// Variables de entorno del servidor: FICHA_URL (ej. https://ficha.empresa.com) y FICHA_API_KEY. Nunca se escriben en el codigo.
const url = () => (process.env.FICHA_URL ?? "").trim().replace(/\/+$/, "");
const llave = () => (process.env.FICHA_API_KEY ?? "").trim();
export const fichaConfigurada = () => {
  const u = url();
  if (!u || !llave()) return false;
  try {
    const x = new URL(u);
    return x.protocol === "https:" || x.hostname === "localhost" || x.hostname === "127.0.0.1";
  } catch { return false; }
};

export type EmpleadoFicha = { id: number; nombre: string; sucursal: string };

async function pedir(ruta: string, init: RequestInit = {}) {
  if (!fichaConfigurada()) throw new ErrorNegocio("Falta configurar la conexión con la ficha (FICHA_URL y FICHA_API_KEY).");
  return fetch(`${url()}${ruta}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), "x-api-key": llave(), "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
}

// Empleados activos (id, nombre, sucursal): se guardan 5 minutos para no consultar la ficha en cada pantalla.
let cache: { t: number; lista: EmpleadoFicha[] } | null = null;
export async function empleadosActivos(forzar = false): Promise<EmpleadoFicha[]> {
  if (!forzar && cache && Date.now() - cache.t < 5 * 60_000) return cache.lista;
  let r: Response;
  try { r = await pedir("/api/empleados-activos"); } catch (e) {
    if (e instanceof ErrorNegocio) throw e;
    throw new ErrorNegocio("No se pudo consultar la lista de empleados a la ficha. Probá de nuevo en un momento.");
  }
  if (r.status === 401) throw new ErrorNegocio("La ficha rechazó la llave del sistema de stock (revisar FICHA_API_KEY).");
  if (!r.ok) throw new ErrorNegocio("La ficha no pudo devolver los empleados. Probá de nuevo en un momento.");
  const datos = (await r.json().catch(() => null)) as unknown;
  if (!Array.isArray(datos)) throw new ErrorNegocio("La ficha devolvió una respuesta que no se entiende.");
  const lista = datos
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({ id: Number(x.id), nombre: String(x.nombre ?? "").slice(0, 80), sucursal: String(x.sucursal ?? "").slice(0, 60) }))
    .filter((x) => Number.isInteger(x.id) && x.id > 0 && x.nombre);
  cache = { t: Date.now(), lista };
  return lista;
}

export async function contarPendientes() {
  const r = await pool.query<{ pendiente: number; error: number }>(
    "select count(*) filter (where estado = 'pendiente')::int as pendiente, count(*) filter (where estado = 'error')::int as error from consumos_empleado where estado <> 'enviado'");
  return r.rows[0];
}

// Manda a la ficha los consumos que faltan (de a uno, en orden). Un reintento no duplica: la ficha reconoce la referencia.
//  - 200/201: enviado.  - 400: la ficha lo rechazo (ej. empleado dado de baja): queda en 'error' para revisar.
//  - 401, 5xx o sin conexion: sigue pendiente y se reintenta. Dos envios a la vez no se pisan (candado).
export async function enviarPendientes(limite = 50) {
  const c = await pool.connect();
  let enviados = 0;
  try {
    const got = await c.query<{ ok: boolean }>("select pg_try_advisory_lock(hashtext('ficha-envio')) as ok");
    if (!got.rows[0].ok) return { enviados: 0, ...(await contarPendientes()) };
    try {
      if (!fichaConfigurada()) return { enviados: 0, ...(await contarPendientes()) };
      const filas = await c.query<{ id: number; referencia: string; empleado_id: number; monto: number; detalle: string }>(
        "select id::int, referencia, empleado_id, monto, detalle from consumos_empleado where estado = 'pendiente' order by id limit $1", [limite]);
      for (const f of filas.rows) {
        let estado: "enviado" | "pendiente" | "error" = "pendiente";
        let motivo: string | null = null;
        try {
          const r = await pedir("/api/compras-empleado", { method: "POST", body: JSON.stringify({ empleadoId: f.empleado_id, monto: f.monto, detalle: f.detalle, referencia: f.referencia }) });
          if (r.status === 200 || r.status === 201) estado = "enviado";
          else {
            const cuerpo = (await r.json().catch(() => ({}))) as { error?: string };
            motivo = `HTTP ${r.status}${cuerpo.error ? `: ${String(cuerpo.error).slice(0, 150)}` : ""}`;
            if (r.status === 400) estado = "error";
          }
        } catch (e) {
          motivo = e instanceof Error ? e.message.slice(0, 150) : "sin conexión";
        }
        await c.query(
          "update consumos_empleado set estado = $2, intentos = intentos + 1, ultimo_error = $3, enviado_en = case when $2 = 'enviado' then now() else enviado_en end where id = $1",
          [f.id, estado, estado === "enviado" ? null : motivo]);
        if (estado === "enviado") enviados++;
        // Si la ficha no esta (sin conexion o llave rechazada) no se insiste con el resto: se reintenta mas tarde.
        if (estado === "pendiente") break;
      }
    } finally {
      await c.query("select pg_advisory_unlock(hashtext('ficha-envio'))").catch(() => {});
    }
    return { enviados, ...(await contarPendientes()) };
  } finally {
    c.release();
  }
}

export async function ultimasCompras(limite = 30) {
  const r = await pool.query<{ codigo: string; empleado: string; creado: Date; monto: number; prendas: number; pendientes: number }>(
    `select codigo, max(empleado_nombre) as empleado, min(creado_en) as creado, sum(monto)::int as monto, sum(cantidad)::int as prendas,
            count(*) filter (where estado <> 'enviado')::int as pendientes
       from consumos_empleado group by codigo order by min(creado_en) desc limit $1`, [Math.min(Math.max(1, limite), 100)]);
  return r.rows.map((x) => ({ ...x, creado: new Date(x.creado).toISOString() }));
}

import { pool } from "../db";
import { cifrar, descifrar, nuevoSecreto } from "./totp";

// Prepara el secreto de la doble verificacion (queda sin activar hasta que se confirme con un codigo).
// IMPORTANTE: esto NO puede estar en un archivo "use server": todo lo que se exporta desde ahi se puede llamar desde
// internet sin iniciar sesion. Solo lo usa la pagina del servidor, que ya verifico la sesion.
export async function secretoParaAlta(usuarioId: number) {
  const r = await pool.query<{ secreto: string | null; activo: boolean }>("select totp_secreto as secreto, totp_activo as activo from usuarios where id = $1", [usuarioId]);
  if (r.rows[0]?.secreto && !r.rows[0].activo) return descifrar(r.rows[0].secreto);
  const nuevo = nuevoSecreto();
  await pool.query("update usuarios set totp_secreto = $2, totp_activo = false where id = $1", [usuarioId, cifrar(nuevo)]);
  return nuevo;
}

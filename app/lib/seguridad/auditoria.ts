import { pool, type Db } from "../db";
import { ipEnCurso, usuarioEnCurso } from "./contexto";

// Registro de auditoria: quien hizo que y cuando. Solo se agrega: la base no deja modificarlo ni borrarlo.
export async function auditar(
  accion: string,
  detalle: Record<string, unknown> = {},
  o: { usuarioId?: number | null; email?: string | null; ip?: string | null; db?: Db } = {},
) {
  const u = usuarioEnCurso();
  await (o.db ?? pool).query(
    "insert into auditoria (usuario_id, usuario_email, accion, detalle, ip) values ($1, $2, $3, $4::jsonb, $5)",
    [o.usuarioId ?? u?.id ?? null, o.email ?? u?.email ?? null, accion, JSON.stringify(detalle), o.ip ?? ipEnCurso()],
  );
}

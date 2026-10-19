import { empresa } from "@/lib/empresa.config";
import { trasladosParaRemito } from "@/lib/repo";
import { remitoPdf } from "@/lib/remitoPdf";
import { puede } from "@/lib/seguridad/permisos";
import { usuarioActual } from "@/lib/seguridad/sesion";

// Solo con sesion iniciada y permiso de remito (administrador, deposito o encargado).
export async function GET(req: Request) {
  const u = await usuarioActual();
  if (!u) return new Response("Iniciá sesión para ver el remito", { status: 401 });
  if (!puede(u.rol, "remito")) return new Response("No tenés permiso para ver remitos", { status: 403 });
  const q = new URL(req.url).searchParams;
  const desde = q.get("desde") ?? "";
  const hasta = q.get("hasta") ?? "";
  const dia = q.get("dia") ?? undefined;
  const ids = empresa.sucursales.map((s) => s.id as string);
  if (!ids.includes(desde) || !ids.includes(hasta) || desde === hasta || (dia && !/^\d{4}-\d{2}-\d{2}$/.test(dia))) {
    return new Response("Datos del remito inválidos", { status: 400 });
  }
  // Un encargado solo puede ver remitos que llegan o salen de su sucursal.
  if ((u.rol === "encargado") && desde !== u.sucursalId && hasta !== u.sucursalId) return new Response("No tenés permiso para ese remito", { status: 403 });
  const items = await trasladosParaRemito(desde, hasta, dia);
  if (items.length === 0) return new Response("No hay envíos para ese remito", { status: 404 });
  const hoy = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const numero = `${hoy}-${hasta.slice(0, 3).toUpperCase()}`;
  const pdf = await remitoPdf(items, desde, hasta, numero);
  return new Response(Buffer.from(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="remito-${numero}.pdf"` },
  });
}

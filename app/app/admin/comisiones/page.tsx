"use client";
import { useEffect, useState } from "react";
import { obtenerComisiones } from "@/app/admin/acciones";
import type { ResultadoComisiones } from "@/lib/comisiones";
import { nombreSucursal, pesos } from "@/lib/util";

// Comisiones por semana (domingo a sabado). Cierra el sabado. El que mas vendio de su sucursal lleva la corona (1,5%).
const dos = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
const dias = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const corto = (f: string) => { const [, m, d] = f.split("-"); return `${d}/${m}`; };
const ESTADO = { cerrada: "Cerrada", cierra_hoy: "Cierra hoy", en_curso: "En curso" } as const;

export default function Comisiones() {
  const [desde, setDesde] = useState(dias(-27));
  const [hasta, setHasta] = useState(dias(0));
  const [ganador, setGanador] = useState<"sucursal" | "total">("sucursal");
  const [datos, setDatos] = useState<ResultadoComisiones | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    obtenerComisiones(desde, hasta, ganador).then((r) => {
      if (!vivo) return;
      if (r.ok) { setDatos(r); setError(null); } else setError(r.motivo);
    });
    return () => { vivo = false; };
  }, [desde, hasta, ganador]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Comisiones</h1>
        <p className="text-sm text-neutral-600">
          {datos ? `${datos.parametros.pct}% de lo vendido en la semana; el que más vendió de su ${ganador === "sucursal" ? "sucursal" : "equipo (todas las sucursales)"} cobra ${datos.parametros.pctGanador}% en lugar del ${datos.parametros.pct}%. ` : ""}
          La semana va de domingo a sábado y cierra el sábado. Se cuenta lo cobrado, sin ventas anuladas, menos las devoluciones (notas de crédito) de la semana. Las ventas sin vendedor no comisionan.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="grid gap-1">Desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded border px-2 py-1" /></label>
        <label className="grid gap-1">Hasta<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded border px-2 py-1" /></label>
        <label className="grid gap-1">El 1,5% se gana contra
          <select value={ganador} onChange={(e) => setGanador(e.target.value as "sucursal" | "total")} className="rounded border px-2 py-1">
            <option value="sucursal">Su sucursal</option>
            <option value="total">Todos juntos</option>
          </select>
        </label>
      </div>
      {error && <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {datos && datos.semanas.length === 0 && <p className="text-sm text-neutral-600">No hay semanas en ese rango.</p>}
      {datos?.semanas.map((s) => (
        <section key={s.desde} className="rounded-lg border bg-white p-4">
          <h2 className="mb-2 flex flex-wrap items-baseline gap-2 font-semibold">
            Semana {corto(s.desde)} al {corto(s.hasta)}
            <span className={`rounded px-2 py-0.5 text-xs ${s.estado === "cerrada" ? "bg-neutral-200" : "bg-amber-100 text-amber-900"}`}>{ESTADO[s.estado]}</span>
            <span className="ml-auto text-sm font-normal text-neutral-600">Vendido {pesos(s.totalVendido)} · Comisiones {pesos(s.totalComision)}</span>
          </h2>
          {s.grupos.length === 0 && <p className="text-sm text-neutral-500">Sin ventas con vendedor.</p>}
          {s.grupos.map((g) => (
            <div key={g.sucursal} className="mb-3 overflow-x-auto">
              <p className="mb-1 text-sm font-medium">{nombreSucursal(g.sucursal)}</p>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-neutral-500"><th className="py-1">Vendedor</th><th className="text-right">Ventas</th><th className="text-right">Vendido</th><th className="text-right">Devuelto</th><th className="text-right">Neto</th><th className="text-right">%</th><th className="text-right">Comisión</th></tr></thead>
                <tbody>
                  {g.vendedores.map((f) => (
                    <tr key={f.vendedorId} className="border-t">
                      <td className="py-1">{f.ganador ? "👑 " : ""}{f.nombre}</td>
                      <td className="text-right">{f.ventas}</td><td className="text-right">{pesos(f.vendido)}</td><td className="text-right">{f.devuelto ? `−${pesos(f.devuelto)}` : "—"}</td>
                      <td className="text-right">{pesos(f.neto)}</td><td className="text-right">{f.pct}%</td><td className="text-right font-medium">{pesos(f.comision)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      ))}
      {datos && datos.porVendedor.length > 0 && (
        <section className="rounded-lg border bg-white p-4">
          <h2 className="mb-2 font-semibold">Total del período ({corto(datos.parametros.desde)} al {corto(datos.parametros.hasta)})</h2>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-neutral-500"><th className="py-1">Vendedor</th><th>Sucursal</th><th className="text-right">Neto</th><th className="text-right">Semanas ganadas</th><th className="text-right">Comisión</th></tr></thead>
            <tbody>
              {datos.porVendedor.map((v) => (
                <tr key={v.vendedorId} className="border-t"><td className="py-1">{v.nombre}</td><td>{nombreSucursal(v.sucursal)}</td><td className="text-right">{pesos(v.neto)}</td><td className="text-right">{v.semanasGanadas}</td><td className="text-right font-medium">{pesos(v.comision)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

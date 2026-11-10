"use client";
import { useEffect, useMemo, useState } from "react";
import { obtenerPanel } from "@/app/admin/acciones";
import { BarrasH, Cifra, Columnas, VerTabla } from "@/components/graficos";
import type { Panel } from "@/lib/informes";
import { empresa } from "@/lib/empresa.config";
import { nombreSucursal, pesos } from "@/lib/util";

// Informes en tres vistas: VENTAS (lo que se mira todos los dias), PRENDAS (que se vende y que no) y CONTROL (notas, envios).
// Un solo filtro arriba; el agrupado del grafico (dia, semana o mes) se elige solo segun el largo del periodo.
type Consulta = { desde: string; hasta: string; sucursal: string; agrupar: string };
type Vista = "ventas" | "prendas" | "control";
const dos = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
const dias = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const PRESETS: { id: string; texto: string; rango: () => [string, string] }[] = [
  { id: "hoy", texto: "Hoy", rango: () => [dias(0), dias(0)] },
  { id: "ayer", texto: "Ayer", rango: () => [dias(-1), dias(-1)] },
  { id: "7", texto: "7 días", rango: () => [dias(-6), dias(0)] },
  { id: "30", texto: "30 días", rango: () => [dias(-29), dias(0)] },
  { id: "mes", texto: "Este mes", rango: () => { const d = new Date(); return [iso(new Date(d.getFullYear(), d.getMonth(), 1)), dias(0)]; } },
  { id: "pasado", texto: "Mes pasado", rango: () => { const d = new Date(); return [iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), iso(new Date(d.getFullYear(), d.getMonth(), 0))]; } },
];
const agruparPara = (desde: string, hasta: string) => {
  const n = (Date.parse(hasta) - Date.parse(desde)) / 86_400_000 + 1;
  return n <= 31 ? "dia" : n <= 120 ? "semana" : "mes";
};
const etiquetaPeriodo = (f: string, agrupar: string) => { const [a, m, d] = f.split("-"); return agrupar === "mes" ? `${m}/${a.slice(2)}` : `${d}/${m}`; };
// El grafico muestra TODOS los dias (o semanas o meses) del periodo: los que no tuvieron ventas quedan en cero, asi el espacio entre columnas es honesto.
type Periodo = { periodo: string; ventas: number; unidades: number; totalPagado: number };
function completar(periodos: Periodo[], agrupado: string, desde: string, hasta: string): Periodo[] {
  const por = new Map(periodos.map((p) => [p.periodo, p]));
  const f = (d: Date) => d.toISOString().slice(0, 10);
  const d = new Date(desde + "T12:00:00Z");
  if (agrupado === "semana") d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  if (agrupado === "mes") d.setUTCDate(1);
  const fin = new Date(hasta + "T12:00:00Z");
  const out: Periodo[] = [];
  for (let n = 0; d <= fin && n < 400; n++) {
    const k = f(d);
    out.push(por.get(k) ?? { periodo: k, ventas: 0, unidades: 0, totalPagado: 0 });
    if (agrupado === "mes") d.setUTCMonth(d.getUTCMonth() + 1); else d.setUTCDate(d.getUTCDate() + (agrupado === "semana" ? 7 : 1));
  }
  return out;
}
const porcentaje = (parte: number, total: number) => (total > 0 ? `${Math.round((parte / total) * 100)}%` : "0%");

function descargarCsv(nombre: string, filas: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const blob = new Blob(["﻿" + filas.map((f) => f.map(esc).join(";")).join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `${nombre}.csv`; a.click(); URL.revokeObjectURL(a.href);
}
const Bloque = ({ titulo, ayuda, csv, children }: { titulo: string; ayuda?: string; csv?: () => void; children: React.ReactNode }) => (
  <section className="bloque-informe">
    <div className="bloque-informe-cab">
      <div><h2>{titulo}</h2>{ayuda && <p className="aviso">{ayuda}</p>}</div>
      {csv && <button className="chico" onClick={csv}>Descargar CSV</button>}
    </div>
    {children}
  </section>
);

export default function Informes() {
  const [f, setF] = useState<Consulta>(() => ({ desde: dias(-29), hasta: dias(0), sucursal: "", agrupar: "dia" }));
  const [preset, setPreset] = useState("30");
  const [vista, setVista] = useState<Vista>("ventas");
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    obtenerPanel({ ...f, agrupar: agruparPara(f.desde, f.hasta), limite: 20 }).then((r) => {
      if (!vivo) return;
      if (r.ok) { setPanel(r.panel); setError(""); } else setError(r.motivo);
      setCargando(false);
    });
    return () => { vivo = false; };
  }, [f]);

  const cambiar = (n: Partial<Consulta>) => { setCargando(true); setF((c) => ({ ...c, ...n })); };
  const t = panel?.resumen.total;
  const ahorroPromos = useMemo(() => panel?.resumen.porSucursal.reduce((s, x) => s + (x.descuentoPromos ?? 0), 0) ?? 0, [panel]);
  const agrupado = panel?.periodo.agrupadoPor ?? "dia";
  const periodos = useMemo(() => (panel ? completar(panel.periodo.periodos, panel.periodo.agrupadoPor, f.desde, f.hasta) : []), [panel, f.desde, f.hasta]);

  return (
    <>
      <h1>Informes</h1>

      <div className="filtro-informe">
        <div className="fila" style={{ gap: 6, flexWrap: "wrap" }} role="group" aria-label="Período">
          {PRESETS.map((p) => (
            <button key={p.id} className={`chico ${preset === p.id ? "on" : ""}`} aria-pressed={preset === p.id}
              onClick={() => { const [d, h] = p.rango(); setPreset(p.id); cambiar({ desde: d, hasta: h }); }}>{p.texto}</button>
          ))}
          <select value={f.sucursal} onChange={(e) => cambiar({ sucursal: e.target.value })} aria-label="Local" style={{ marginLeft: "auto" }}>
            <option value="">Todos los locales</option>{empresa.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
        <details className="fechas-exactas">
          <summary>Otras fechas</summary>
          <div className="fila" style={{ gap: 10, flexWrap: "wrap", marginTop: 8 }}>
            <label className="fila" style={{ gap: 6 }}>Desde <input type="date" value={f.desde} max={f.hasta} onChange={(e) => { setPreset(""); cambiar({ desde: e.target.value }); }} /></label>
            <label className="fila" style={{ gap: 6 }}>Hasta <input type="date" value={f.hasta} min={f.desde} onChange={(e) => { setPreset(""); cambiar({ hasta: e.target.value }); }} /></label>
          </div>
        </details>
      </div>

      <div className="vistas-informe" role="tablist" aria-label="Informes">
        {([["ventas", "Ventas"], ["prendas", "Prendas"], ["control", "Control"]] as [Vista, string][]).map(([id, texto]) => (
          <button key={id} role="tab" aria-selected={vista === id} className={vista === id ? "activa" : ""} onClick={() => setVista(id)}>{texto}</button>
        ))}
        <span className="aviso" style={{ marginLeft: "auto", alignSelf: "center" }}>{cargando ? "Calculando…" : `${f.desde === f.hasta ? f.desde.split("-").reverse().join("/") : `${f.desde.split("-").reverse().join("/")} al ${f.hasta.split("-").reverse().join("/")}`}`}</span>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      {panel && t && vista === "ventas" && (
        <>
          <div className="cifras">
            <Cifra grande titulo="Total pagado" valor={pesos(t.totalPagado)} nota={ahorroPromos > 0 ? `Lo que pagaron los clientes · promos: ${pesos(ahorroPromos)} de descuento` : "Lo que pagaron los clientes"} />
            <Cifra titulo="Cobrado en caja" valor={pesos(t.cobradoEnCaja)} nota={t.pagadoConNotas > 0 ? `y ${pesos(t.pagadoConNotas)} con notas de crédito` : "sin notas de crédito"} />
            <Cifra titulo="Ventas" valor={String(t.ventas)} nota={`${t.unidades} ${t.unidades === 1 ? "prenda" : "prendas"}`} />
            <Cifra titulo="Ticket promedio" valor={pesos(t.ticketPromedio)} nota={t.ventas ? `${(t.unidades / t.ventas).toFixed(1).replace(".", ",")} prendas por venta` : undefined} />
          </div>

          <Bloque titulo="Cómo viene la venta" ayuda={`Total pagado por ${agrupado === "dia" ? "día" : agrupado}. Pasá el mouse por una columna.`}
            csv={() => descargarCsv("evolucion", [["Período", "Ventas", "Prendas", "Total pagado"], ...periodos.map((p) => [p.periodo, p.ventas, p.unidades, p.totalPagado])])}>
            <Columnas formato={pesos} datos={periodos.map((p) => ({ etiqueta: etiquetaPeriodo(p.periodo, agrupado), valor: p.totalPagado, detalle: `${p.ventas} ${p.ventas === 1 ? "venta" : "ventas"}` }))} />
            <VerTabla encabezados={["Período", "Ventas", "Prendas", "Total pagado"]} filas={periodos.filter((p) => p.ventas > 0).map((p) => [etiquetaPeriodo(p.periodo, agrupado), p.ventas, p.unidades, pesos(p.totalPagado)])} />
          </Bloque>

          <div className="dos-columnas">
            {!f.sucursal && (
              <Bloque titulo="Por local" csv={() => descargarCsv("ventas-por-local", [["Local", "Ventas", "Prendas", "Total pagado", "Cobrado en caja", "Con notas", "Ticket promedio"], ...panel.resumen.porSucursal.map((s) => [s.nombre, s.ventas, s.unidades, s.totalPagado, s.cobradoEnCaja, s.pagadoConNotas, s.ticketPromedio])])}>
                <BarrasH filas={[...panel.resumen.porSucursal].sort((a, b) => b.totalPagado - a.totalPagado).map((s) => ({ id: s.sucursal, nombre: s.nombre, valor: s.totalPagado, texto: pesos(s.totalPagado), detalle: `${s.ventas} ${s.ventas === 1 ? "venta" : "ventas"} · ticket ${pesos(s.ticketPromedio)}` }))} />
              </Bloque>
            )}
            <Bloque titulo="Cómo pagaron" csv={() => descargarCsv("medios-de-pago", [["Medio", "Monto", "Ventas"], ...t.porMedio.map((m) => [m.nombre, m.monto, m.ventas])])}>
              <BarrasH filas={[...t.porMedio].sort((a, b) => b.monto - a.monto).map((m) => { const tot = t.porMedio.reduce((s, x) => s + x.monto, 0); return { id: m.medio, nombre: m.nombre, valor: m.monto, texto: `${pesos(m.monto)} · ${porcentaje(m.monto, tot)}`, detalle: `${m.ventas} ${m.ventas === 1 ? "venta" : "ventas"}` }; })} />
            </Bloque>
          </div>

          <Bloque titulo="Cuándo se vende" ayuda="Cantidad de ventas por día de la semana y por hora.">
            <div className="dos-columnas">
              <div>
                <p className="mini-titulo">Por día de la semana</p>
                <Columnas alto={140} formato={(n) => `${n} ${n === 1 ? "venta" : "ventas"}`} datos={panel.horarios.porDiaDeLaSemana.map((d) => ({ etiqueta: d.dia.slice(0, 3), valor: d.ventas, detalle: pesos(d.total) }))} />
              </div>
              <div>
                <p className="mini-titulo">Por hora</p>
                <Columnas alto={140} formato={(n) => `${n} ${n === 1 ? "venta" : "ventas"}`} datos={panel.horarios.porHora.map((h) => ({ etiqueta: `${dos(h.hora)}h`, valor: h.ventas, detalle: pesos(h.total) }))} />
              </div>
            </div>
          </Bloque>
        </>
      )}

      {panel && t && vista === "prendas" && (
        <>
          <Bloque titulo="Las que más se venden" ayuda="Vendidas menos devueltas, y en qué local."
            csv={() => descargarCsv("prendas-mas-vendidas", [["Puesto", "SKU", "Prenda", "Vendidas", "Devueltas", "Netas"], ...panel.prendasMasVendidas.prendas.map((p) => [p.puesto, p.sku, p.nombre, p.vendidas, p.devueltas, p.netas])])}>
            <BarrasH vacio="No hay ventas en este período." filas={panel.prendasMasVendidas.prendas.map((p) => ({ id: p.sku, nombre: `${p.puesto}. ${p.nombre}`, valor: p.netas, texto: `${p.netas} ${p.netas === 1 ? "prenda" : "prendas"}`, detalle: Object.entries(p.porSucursal).map(([s, n]) => `${nombreSucursal(s)} ${n}`).join(" · ") }))} />
          </Bloque>

          <Bloque titulo="Las que no se mueven" ayuda="Prendas con stock que menos se vendieron en el período: candidatas a mandar a otro local, a feria o a promo."
            csv={() => descargarCsv("prendas-menos-vendidas", [["SKU", "Prenda", "Stock", "Vendidas", "Stock a lista", "Último ingreso"], ...panel.prendasMenosVendidas.prendas.map((p) => [p.sku, p.nombre, p.stock, p.vendidasEnElPeriodo, p.valorStockALista, p.ultimoIngreso ?? ""])])}>
            {panel.prendasMenosVendidas.prendas.length === 0 ? <p className="aviso">No hay prendas con stock.</p> : (
              <div style={{ overflowX: "auto" }}><table>
                <thead><tr><th>Prenda</th><th className="der">Stock</th><th className="der">Vendidas</th><th className="der">Stock a lista</th><th>Último ingreso</th></tr></thead>
                <tbody>{panel.prendasMenosVendidas.prendas.map((p) => (
                  <tr key={p.sku}><td>{p.nombre} <span className="interno">· {p.sku}</span></td><td className="der">{p.stock}</td><td className="der">{p.vendidasEnElPeriodo}</td><td className="der">{pesos(p.valorStockALista)}</td><td>{p.ultimoIngreso ?? "—"}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </Bloque>

          <Bloque titulo="Stock de hoy" ayuda="Valorizado a precio de lista. No depende de las fechas elegidas.">
            <BarrasH filas={[...panel.stock.porSucursal].sort((a, b) => b.valorALista - a.valorALista).map((s) => ({ id: s.sucursal, nombre: s.nombre, valor: s.valorALista, texto: pesos(s.valorALista), detalle: `${s.unidades} prendas · ${s.modelos} modelos` }))} />
            <p style={{ margin: "10px 0 0" }}>Total: <strong>{panel.stock.totalUnidades} prendas</strong> · <strong>{pesos(panel.stock.totalValorALista)}</strong></p>
            {panel.stock.enCaminoSinRecibir.length > 0 && <p className="aviso">En camino sin recibir: {panel.stock.enCaminoSinRecibir.map((e) => `${e.nombre} ${e.unidades} prendas`).join(" · ")}</p>}
          </Bloque>
        </>
      )}

      {panel && t && vista === "control" && (
        <>
          <div className="cifras">
            <Cifra titulo="Notas de crédito emitidas" valor={String(panel.notasCredito.resumen.emitidas)} nota={pesos(panel.notasCredito.resumen.montoEmitido)} />
            <Cifra titulo="Prendas devueltas" valor={String(panel.notasCredito.resumen.unidadesDevueltas)} nota={`${panel.notasCredito.resumen.unidadesFalladas} falladas`} />
            <Cifra titulo="Usadas como pago" valor={pesos(panel.notasCredito.resumen.usadoComoPagoEnElPeriodo)} nota="en este período" />
            <Cifra titulo="Saldo sin usar" valor={pesos(panel.notasCredito.resumen.saldoPendienteDeUsar)} nota={`${panel.notasCredito.resumen.notasConSaldo} ${panel.notasCredito.resumen.notasConSaldo === 1 ? "nota" : "notas"} con saldo`} />
          </div>

          <Bloque titulo="Notas de crédito" csv={() => descargarCsv("notas-de-credito", [["Código", "Fecha", "Local", "Venta", "Monto", "Saldo", "Prendas", "Falladas", "Emitida por"], ...panel.notasCredito.notas.map((n) => [n.codigo, n.fecha, nombreSucursal(n.sucursal), n.ventaOriginal, n.monto, n.saldo, n.unidades, n.falladas, n.emitidaPor ?? ""])])}>
            {panel.notasCredito.notas.length === 0 ? <p className="aviso">No se emitieron notas en este período.</p> : (
              <div style={{ overflowX: "auto" }}><table>
                <thead><tr><th>Código</th><th>Fecha</th><th>Local</th><th className="der">Monto</th><th className="der">Saldo</th><th className="der">Prendas</th><th>Emitida por</th></tr></thead>
                <tbody>{panel.notasCredito.notas.map((n) => (
                  <tr key={n.codigo}><td className="mono">{n.codigo}</td><td>{new Date(n.fecha).toLocaleString("es-AR", { hour12: false, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td><td>{nombreSucursal(n.sucursal)}</td><td className="der">{pesos(n.monto)}</td><td className="der">{pesos(n.saldo)}</td><td className="der">{n.unidades}{n.falladas > 0 ? ` (${n.falladas} falladas)` : ""}</td><td>{n.emitidaPor ?? "—"}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </Bloque>

          <Bloque titulo="Mercadería cargada y enviada" ayuda={`Cargado en el depósito en este período: ${panel.ingresos.totalCargado} prendas.`}>
            {panel.ingresos.enviosPorDestino.length === 0 ? <p className="aviso">No hubo envíos en este período.</p> : (
              <div style={{ overflowX: "auto" }}><table>
                <thead><tr><th>Destino</th><th className="der">Enviadas</th><th className="der">Recibidas</th><th className="der">Sin recibir</th></tr></thead>
                <tbody>{panel.ingresos.enviosPorDestino.map((e) => (
                  <tr key={e.destino}><td>{e.nombre}</td><td className="der">{e.enviadas}</td><td className="der">{e.recibidas}</td><td className="der">{e.sinRecibir > 0 ? <strong>{e.sinRecibir}</strong> : 0}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </Bloque>
        </>
      )}
    </>
  );
}

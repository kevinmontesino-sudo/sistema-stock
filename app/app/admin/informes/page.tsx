"use client";
import { Fragment, useEffect, useState } from "react";
import { obtenerPanel } from "@/app/admin/acciones";
import type { Panel } from "@/lib/informes";
import { empresa } from "@/lib/empresa.config";
import { nombreSucursal, pesos } from "@/lib/util";

type Consulta = { desde: string; hasta: string; sucursal: string; agrupar: string };
const dos = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
const dias = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const PRESETS: { texto: string; rango: () => [string, string] }[] = [
  { texto: "Hoy", rango: () => [dias(0), dias(0)] },
  { texto: "Ayer", rango: () => [dias(-1), dias(-1)] },
  { texto: "Últimos 7 días", rango: () => [dias(-6), dias(0)] },
  { texto: "Últimos 30 días", rango: () => [dias(-29), dias(0)] },
  { texto: "Este mes", rango: () => { const d = new Date(); return [iso(new Date(d.getFullYear(), d.getMonth(), 1)), dias(0)]; } },
  { texto: "Mes pasado", rango: () => { const d = new Date(); return [iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), iso(new Date(d.getFullYear(), d.getMonth(), 0))]; } },
];
const etiquetaPeriodo = (f: string, agrupar: string) => { const [a, m, d] = f.split("-"); return agrupar === "mes" ? `${m}/${a}` : agrupar === "semana" ? `sem. ${d}/${m}` : `${d}/${m}`; };

function descargarCsv(nombre: string, filas: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const blob = new Blob(["﻿" + filas.map((f) => f.map(esc).join(";")).join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `${nombre}.csv`; a.click(); URL.revokeObjectURL(a.href);
}
const Barra = ({ valor, max }: { valor: number; max: number }) => (
  <div style={{ background: "var(--borde)", borderRadius: 4, height: 8, minWidth: 80 }}>
    <div style={{ width: `${max > 0 ? Math.max(2, (valor / max) * 100) : 0}%`, height: 8, borderRadius: 4, background: "var(--acento)" }} />
  </div>
);
const Tarjeta = ({ titulo, valor, nota }: { titulo: string; valor: string; nota?: string }) => (
  <div className="tarjeta" style={{ padding: 14 }}>
    <p className="aviso" style={{ margin: 0 }}>{titulo}</p>
    <p style={{ margin: "4px 0", fontSize: 24, fontWeight: 700 }}>{valor}</p>
    {nota && <p className="aviso" style={{ margin: 0, fontSize: 12 }}>{nota}</p>}
  </div>
);
const Seccion = ({ titulo, csv, children }: { titulo: string; csv?: () => void; children: React.ReactNode }) => (
  <section style={{ marginTop: 24 }}>
    <div className="fila" style={{ justifyContent: "space-between" }}><h2 style={{ margin: 0 }}>{titulo}</h2>{csv && <button className="chico" onClick={csv}>Descargar CSV</button>}</div>
    <div className="tarjeta" style={{ overflowX: "auto", marginTop: 8 }}>{children}</div>
  </section>
);

export default function Informes() {
  const [f, setF] = useState<Consulta>({ desde: dias(-29), hasta: dias(0), sucursal: "", agrupar: "dia" });
  const [consulta, setConsulta] = useState<Consulta>(f);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    obtenerPanel({ ...consulta, limite: 20 }).then((r) => {
      if (!vivo) return;
      if (r.ok) { setPanel(r.panel); setError(""); } else setError(r.motivo);
      setCargando(false);
    });
    return () => { vivo = false; };
  }, [consulta]);

  const aplicar = (n: Consulta) => { setF(n); setConsulta(n); setCargando(true); };
  const t = panel?.resumen.total;
  const maxPer = Math.max(0, ...(panel?.periodo.periodos.map((p) => p.totalPagado) ?? [0]));
  const maxTop = Math.max(0, ...(panel?.prendasMasVendidas.prendas.map((p) => p.netas) ?? [0]));
  const maxHora = Math.max(0, ...(panel?.horarios.porHora.map((h) => h.ventas) ?? [0]));
  const maxDia = Math.max(0, ...(panel?.horarios.porDiaDeLaSemana.map((h) => h.ventas) ?? [0]));

  return (
    <>
      <h1>Informes</h1>
      <p className="aviso" style={{ marginTop: -8 }}>Números de ventas, prendas y notas. Las fechas son de Argentina y el rango incluye ambos días.</p>
      <div className="tarjeta">
        <div className="fila" style={{ gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {PRESETS.map((p) => <button key={p.texto} className="chico" onClick={() => { const [d, h] = p.rango(); aplicar({ ...f, desde: d, hasta: h }); }}>{p.texto}</button>)}
        </div>
        <form className="fila" style={{ gap: 10, flexWrap: "wrap" }} onSubmit={(e) => { e.preventDefault(); aplicar(f); }}>
          <label className="fila" style={{ gap: 6 }}>Desde <input type="date" value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} required /></label>
          <label className="fila" style={{ gap: 6 }}>Hasta <input type="date" value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} required /></label>
          <select value={f.sucursal} onChange={(e) => setF({ ...f, sucursal: e.target.value })}>
            <option value="">Todas las sucursales</option>{empresa.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
          <select value={f.agrupar} onChange={(e) => setF({ ...f, agrupar: e.target.value })}>
            <option value="dia">Por día</option><option value="semana">Por semana</option><option value="mes">Por mes</option>
          </select>
          <button className="principal" type="submit" disabled={cargando}>{cargando ? "Calculando…" : "Actualizar"}</button>
        </form>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      {panel && t && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginTop: 16 }}>
            <Tarjeta titulo="Ventas" valor={String(t.ventas)} nota={`${t.unidades} prendas`} />
            <Tarjeta titulo="Total pagado" valor={pesos(t.totalPagado)} nota={`a lista serían ${pesos(t.lista)}`} />
            <Tarjeta titulo="Cobrado en caja" valor={pesos(t.cobradoEnCaja)} nota="sin notas de crédito" />
            <Tarjeta titulo="Ticket promedio" valor={pesos(t.ticketPromedio)} />
            <Tarjeta titulo="Pagado con notas" valor={pesos(t.pagadoConNotas)} nota={`${panel.notasCredito.resumen.ventasPagadasConNotas} ${panel.notasCredito.resumen.ventasPagadasConNotas === 1 ? "venta" : "ventas"}`} />
          </div>

          <Seccion titulo="Por sucursal" csv={() => descargarCsv("ventas-por-sucursal", [["Sucursal", "Ventas", "Prendas", "A lista", "Total pagado", "Cobrado en caja", "Con notas", "Ticket promedio"], ...panel.resumen.porSucursal.map((s) => [s.nombre, s.ventas, s.unidades, s.lista, s.totalPagado, s.cobradoEnCaja, s.pagadoConNotas, s.ticketPromedio])])}>
            <table>
              <thead><tr><th>Sucursal</th><th className="der">Ventas</th><th className="der">Prendas</th><th className="der">Total pagado</th><th className="der">Cobrado en caja</th><th className="der">Con notas</th><th className="der">Ticket promedio</th></tr></thead>
              <tbody>
                {panel.resumen.porSucursal.map((s) => <tr key={s.sucursal}><td>{s.nombre}</td><td className="der">{s.ventas}</td><td className="der">{s.unidades}</td><td className="der">{pesos(s.totalPagado)}</td><td className="der">{pesos(s.cobradoEnCaja)}</td><td className="der">{pesos(s.pagadoConNotas)}</td><td className="der">{pesos(s.ticketPromedio)}</td></tr>)}
                {panel.resumen.porSucursal.length === 0 && <tr><td colSpan={7} className="aviso">No hay ventas en ese período.</td></tr>}
              </tbody>
            </table>
          </Seccion>

          <Seccion titulo={`Evolución de ventas (por ${panel.periodo.agrupadoPor === "dia" ? "día" : panel.periodo.agrupadoPor})`} csv={() => descargarCsv("evolucion", [["Período", "Ventas", "Prendas", "Total pagado"], ...panel.periodo.periodos.map((p) => [p.periodo, p.ventas, p.unidades, p.totalPagado])])}>
            <table><tbody>
              {panel.periodo.periodos.map((p) => <tr key={p.periodo}><td style={{ width: 80 }}>{etiquetaPeriodo(p.periodo, panel.periodo.agrupadoPor)}</td><td style={{ width: "50%" }}><Barra valor={p.totalPagado} max={maxPer} /></td><td className="der">{pesos(p.totalPagado)}</td><td className="der aviso">{p.ventas} {p.ventas === 1 ? "venta" : "ventas"}</td></tr>)}
              {panel.periodo.periodos.length === 0 && <tr><td className="aviso">Sin datos.</td></tr>}
            </tbody></table>
          </Seccion>

          <Seccion titulo="Medios de pago" csv={() => descargarCsv("medios-de-pago", [["Medio", "Monto", "Ventas"], ...t.porMedio.map((m) => [m.nombre, m.monto, m.ventas])])}>
            <table>
              <thead><tr><th>Medio</th><th className="der">Monto</th><th className="der">Ventas</th><th>Participación</th></tr></thead>
              <tbody>{t.porMedio.map((m) => { const tot = t.porMedio.reduce((s, x) => s + x.monto, 0); return <tr key={m.medio}><td>{m.nombre}</td><td className="der">{pesos(m.monto)}</td><td className="der">{m.ventas}</td><td><Barra valor={m.monto} max={tot} /> <span className="aviso">{tot ? Math.round((m.monto / tot) * 100) : 0}%</span></td></tr>; })}</tbody>
            </table>
          </Seccion>

          <Seccion titulo="Prendas más vendidas" csv={() => descargarCsv("prendas-mas-vendidas", [["Puesto", "SKU", "Prenda", "Vendidas", "Devueltas", "Netas", "Importe a lista"], ...panel.prendasMasVendidas.prendas.map((p) => [p.puesto, p.sku, p.nombre, p.vendidas, p.devueltas, p.netas, p.importeLista])])}>
            <table>
              <thead><tr><th>#</th><th>Prenda</th><th className="der">Netas</th><th></th><th className="der">Vendidas</th><th className="der">Devueltas</th><th className="der">A lista</th><th>Por local</th></tr></thead>
              <tbody>
                {panel.prendasMasVendidas.prendas.map((p) => (
                  <tr key={p.sku}><td>{p.puesto}</td><td>{p.nombre} <span className="interno">· {p.sku}</span></td><td className="der"><strong>{p.netas}</strong></td><td style={{ width: 120 }}><Barra valor={p.netas} max={maxTop} /></td><td className="der">{p.vendidas}</td><td className="der">{p.devueltas}</td><td className="der">{pesos(p.importeLista)}</td>
                    <td className="aviso">{Object.entries(p.porSucursal).map(([s, n]) => `${nombreSucursal(s)} ${n}`).join(" · ")}</td></tr>
                ))}
                {panel.prendasMasVendidas.prendas.length === 0 && <tr><td colSpan={8} className="aviso">No hay ventas en ese período.</td></tr>}
              </tbody>
            </table>
          </Seccion>

          <Seccion titulo="Prendas que menos se venden (con stock)" csv={() => descargarCsv("prendas-menos-vendidas", [["SKU", "Prenda", "Stock", "Vendidas en el período", "Valor del stock a lista", "Último ingreso"], ...panel.prendasMenosVendidas.prendas.map((p) => [p.sku, p.nombre, p.stock, p.vendidasEnElPeriodo, p.valorStockALista, p.ultimoIngreso ?? ""])])}>
            <table>
              <thead><tr><th>Prenda</th><th className="der">Stock</th><th className="der">Vendidas</th><th className="der">Stock a lista</th><th>Último ingreso</th></tr></thead>
              <tbody>
                {panel.prendasMenosVendidas.prendas.map((p) => <tr key={p.sku}><td>{p.nombre} <span className="interno">· {p.sku}</span></td><td className="der">{p.stock}</td><td className="der">{p.vendidasEnElPeriodo}</td><td className="der">{pesos(p.valorStockALista)}</td><td>{p.ultimoIngreso ?? "—"}</td></tr>)}
                {panel.prendasMenosVendidas.prendas.length === 0 && <tr><td colSpan={5} className="aviso">No hay prendas con stock.</td></tr>}
              </tbody>
            </table>
          </Seccion>

          <Seccion titulo="Cuándo se vende">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 24 }}>
              <table><thead><tr><th colSpan={3}>Por día de la semana</th></tr></thead><tbody>{panel.horarios.porDiaDeLaSemana.map((d) => <tr key={d.dia}><td>{d.dia}</td><td style={{ width: "50%" }}><Barra valor={d.ventas} max={maxDia} /></td><td className="der">{d.ventas}</td></tr>)}</tbody></table>
              <table><thead><tr><th colSpan={3}>Por hora</th></tr></thead><tbody>{panel.horarios.porHora.map((h) => <tr key={h.hora}><td>{dos(h.hora)}:00</td><td style={{ width: "50%" }}><Barra valor={h.ventas} max={maxHora} /></td><td className="der">{h.ventas}</td></tr>)}</tbody></table>
            </div>
          </Seccion>

          <Seccion titulo="Notas de crédito y devoluciones" csv={() => descargarCsv("notas-de-credito", [["Código", "Fecha", "Sucursal", "Venta", "Monto", "Saldo", "Prendas", "Falladas", "Emitida por"], ...panel.notasCredito.notas.map((n) => [n.codigo, n.fecha, nombreSucursal(n.sucursal), n.ventaOriginal, n.monto, n.saldo, n.unidades, n.falladas, n.emitidaPor ?? ""])])}>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 10 }}>
              <span>Emitidas: <strong>{panel.notasCredito.resumen.emitidas}</strong> por <strong>{pesos(panel.notasCredito.resumen.montoEmitido)}</strong></span>
              <span>Prendas devueltas: <strong>{panel.notasCredito.resumen.unidadesDevueltas}</strong> (falladas: {panel.notasCredito.resumen.unidadesFalladas})</span>
              <span>Usadas como pago: <strong>{pesos(panel.notasCredito.resumen.usadoComoPagoEnElPeriodo)}</strong></span>
              <span>Saldo pendiente de usar: <strong>{pesos(panel.notasCredito.resumen.saldoPendienteDeUsar)}</strong> ({panel.notasCredito.resumen.notasConSaldo} notas)</span>
            </div>
            <table>
              <thead><tr><th>Código</th><th>Fecha</th><th>Sucursal</th><th className="der">Monto</th><th className="der">Saldo</th><th className="der">Prendas</th><th className="der">Falladas</th><th>Emitida por</th></tr></thead>
              <tbody>
                {panel.notasCredito.notas.map((n) => <tr key={n.codigo}><td className="mono">{n.codigo}</td><td>{new Date(n.fecha).toLocaleString("es-AR", { hour12: false })}</td><td>{nombreSucursal(n.sucursal)}</td><td className="der">{pesos(n.monto)}</td><td className="der">{pesos(n.saldo)}</td><td className="der">{n.unidades}</td><td className="der">{n.falladas}</td><td>{n.emitidaPor ?? "—"}</td></tr>)}
                {panel.notasCredito.notas.length === 0 && <tr><td colSpan={8} className="aviso">No se emitieron notas en ese período.</td></tr>}
              </tbody>
            </table>
          </Seccion>

          <Seccion titulo="Stock de hoy (a precio de lista)">
            <table>
              <thead><tr><th>Sucursal</th><th className="der">Prendas</th><th className="der">Modelos</th><th className="der">Valor a lista</th></tr></thead>
              <tbody>
                {panel.stock.porSucursal.map((s) => <tr key={s.sucursal}><td>{s.nombre}</td><td className="der">{s.unidades}</td><td className="der">{s.modelos}</td><td className="der">{pesos(s.valorALista)}</td></tr>)}
                <tr><td><strong>Total</strong></td><td className="der"><strong>{panel.stock.totalUnidades}</strong></td><td></td><td className="der"><strong>{pesos(panel.stock.totalValorALista)}</strong></td></tr>
              </tbody>
            </table>
            {panel.stock.enCaminoSinRecibir.length > 0 && <p className="aviso">En camino sin recibir: {panel.stock.enCaminoSinRecibir.map((e) => `${e.nombre} ${e.unidades} prendas`).join(" · ")}</p>}
          </Seccion>

          <Seccion titulo="Mercadería cargada y enviada en el período">
            <p style={{ marginTop: 0 }}>Cargado en el depósito: <strong>{panel.ingresos.totalCargado}</strong> prendas.</p>
            <table>
              <thead><tr><th>Destino</th><th className="der">Enviadas</th><th className="der">Recibidas</th><th className="der">Sin recibir</th></tr></thead>
              <tbody>
                {panel.ingresos.enviosPorDestino.map((e) => <Fragment key={e.destino}><tr><td>{e.nombre}</td><td className="der">{e.enviadas}</td><td className="der">{e.recibidas}</td><td className="der">{e.sinRecibir}</td></tr></Fragment>)}
                {panel.ingresos.enviosPorDestino.length === 0 && <tr><td colSpan={4} className="aviso">No hubo envíos en ese período.</td></tr>}
              </tbody>
            </table>
          </Seccion>
        </>
      )}
    </>
  );
}

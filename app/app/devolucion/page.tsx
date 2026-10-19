"use client";
import { useCallback, useEffect, useState } from "react";
import { emitirNotaCredito, ventaParaDevolver } from "@/app/actions";
import { TicketNota } from "@/components/TicketNota";
import { empresa } from "@/lib/empresa.config";
import { useEscaner, useSucursal } from "@/lib/hooks";
import { imprimir } from "@/lib/imprimir";
import { codigoVenta, DIAS_DEVOLUCION, ES_CODIGO_NOTA, nombreSucursal, pesos, type NotaCredito, type VentaDevolvible } from "@/lib/util";

export default function DevolucionPage() {
  const [sucursal] = useSucursal();
  const [manual, setManual] = useState("");
  const [venta, setVenta] = useState<VentaDevolvible | null>(null);
  const [cant, setCant] = useState<Record<number, number>>({});
  // Unidades falladas de cada renglon: dan igual el vale, pero no vuelven al stock.
  const [falladas, setFalladas] = useState<Record<number, number>>({});
  const [aviso, setAviso] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [nota, setNota] = useState<NotaCredito | null>(null);
  const [aImprimir, setAImprimir] = useState(false);

  const buscar = useCallback(async (codigo: string) => {
    const t = codigo.trim();
    if (!t) return;
    if (ES_CODIGO_NOTA.test(t)) return setAviso("Eso es una nota de crédito. Para devolver, escaneá el código del ticket de la venta (empieza con V).");
    const r = await ventaParaDevolver(t);
    if (!r.ok) return setAviso(r.motivo);
    setAviso("");
    setNota(null);
    setCant({});
    setFalladas({});
    setVenta(r.venta);
  }, []);
  useEscaner(buscar);

  const valor = venta ? venta.items.reduce((s, i) => s + (cant[i.id] ?? 0) * i.valor, 0) : 0;
  const unidades = Object.values(cant).reduce((s, n) => s + n, 0);

  async function emitir() {
    if (!venta || guardando || unidades === 0) return;
    setGuardando(true);
    const r = await emitirNotaCredito(sucursal, venta.id, venta.items.map((i) => ({ itemId: i.id, cant: cant[i.id] ?? 0, falladas: Math.min(falladas[i.id] ?? 0, cant[i.id] ?? 0) })));
    setGuardando(false);
    if (!r.ok) return setAviso(r.motivo);
    setAviso("");
    setNota(r.nota);
    setVenta(null);
    setCant({});
    setFalladas({});
    setAImprimir(true);
  }

  useEffect(() => {
    if (!aImprimir) return;
    const t = setTimeout(() => {
      imprimir(`${empresa.ticketMm.ancho}mm auto`);
      setAImprimir(false);
    }, 400);
    return () => clearTimeout(t);
  }, [aImprimir]);

  return (
    <>
      <h1>Devolución · {nombreSucursal(sucursal)}</h1>
      <p className="aviso no-print" style={{ marginTop: -8 }}>
        Escaneá el código de barras del ticket de la compra. Las prendas que se devuelven vuelven al stock de {nombreSucursal(sucursal)}.
      </p>
      <form className="fila no-print" onSubmit={(e) => { e.preventDefault(); buscar(manual); setManual(""); }}>
        <input type="text" value={manual} autoComplete="off" autoFocus onChange={(e) => setManual(e.target.value)}
          placeholder="Escaneá el ticket de venta (o escribí su número)" style={{ flex: 1, minWidth: 200 }} />
        <button type="submit">Buscar</button>
      </form>
      <p className="error no-print" role="alert" style={{ margin: "8px 0" }}>{aviso}</p>

      {venta && (
        <div className="tarjeta no-print">
          <h2 style={{ marginTop: 0 }}>
            Compra {codigoVenta(venta.id)} · {nombreSucursal(venta.sucursal)} · {new Date(venta.fecha).toLocaleDateString("es-AR")}
          </h2>
          <table>
            <thead><tr><th>Prenda</th><th className="der">Vendidas</th><th className="der">Ya devueltas</th><th className="der">Vale c/u</th><th className="der">Devuelve</th></tr></thead>
            <tbody>
              {venta.items.map((i) => {
                const max = i.vendidas - i.devueltas;
                const n = cant[i.id] ?? 0;
                return (
                  <tr key={i.id}>
                    <td>{i.nombre} <span className="interno">· {i.sku}</span></td>
                    <td className="der">{i.vendidas}</td>
                    <td className="der">{i.devueltas}</td>
                    <td className="der">{pesos(i.valor)}</td>
                    <td className="der">
                      {max === 0 ? <span className="aviso">—</span> : (
                        <span className="fila" style={{ justifyContent: "flex-end", gap: 6 }}>
                          <button className="chico" onClick={() => { setCant((c) => ({ ...c, [i.id]: Math.max(0, (c[i.id] ?? 0) - 1) })); setFalladas((f) => ({ ...f, [i.id]: Math.min(f[i.id] ?? 0, Math.max(0, n - 1)) })); }} disabled={n === 0}>−</button>
                          <strong style={{ minWidth: 20, textAlign: "center" }}>{n}</strong>
                          <button className="chico" onClick={() => setCant((c) => ({ ...c, [i.id]: Math.min(max, (c[i.id] ?? 0) + 1) }))} disabled={n >= max}>+</button>
                        </span>
                      )}
                      {n > 0 && (
                        <span className="fila" style={{ justifyContent: "flex-end", gap: 6, marginTop: 6, fontSize: 13 }}>
                          <span className="aviso">Falladas (no vuelven al stock)</span>
                          <button className="chico" onClick={() => setFalladas((f) => ({ ...f, [i.id]: Math.max(0, (f[i.id] ?? 0) - 1) }))} disabled={(falladas[i.id] ?? 0) === 0}>−</button>
                          <strong style={{ minWidth: 20, textAlign: "center" }}>{Math.min(falladas[i.id] ?? 0, n)}</strong>
                          <button className="chico" onClick={() => setFalladas((f) => ({ ...f, [i.id]: Math.min(n, (f[i.id] ?? 0) + 1) }))} disabled={(falladas[i.id] ?? 0) >= n}>+</button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="aviso">
            El vale es por lo que el cliente pagó por cada prenda (con el descuento o recargo de su medio de pago) y no vence. Se acepta devolver hasta {DIAS_DEVOLUCION} días después de la compra. Solo se devuelve en vale, no en efectivo.
            Si no marcás una prenda como fallada, vuelve al stock de {nombreSucursal(sucursal)}.
          </p>
          <div className="fila" style={{ justifyContent: "space-between" }}>
            <span>{unidades} prendas a devolver</span>
            <strong style={{ fontSize: 20 }}>{pesos(valor)}</strong>
          </div>
          <button className="principal" style={{ width: "100%", marginTop: 12 }} onClick={emitir} disabled={unidades === 0 || guardando}>
            {guardando ? "Emitiendo…" : unidades === 0 ? "Elegí qué prendas devuelve" : `Emitir nota de crédito por ${pesos(valor)}`}
          </button>
        </div>
      )}

      {nota && (
        <div className="tarjeta no-print">
          <h2 style={{ marginTop: 0 }}>Nota {nota.codigo} emitida por {pesos(nota.montoInicial)}</h2>
          {(() => {
            const total = nota.items.reduce((s, i) => s + i.cantidad, 0);
            const malas = nota.items.reduce((s, i) => s + i.falladas, 0);
            return (
              <p className="aviso">
                {total - malas > 0 ? `${total - malas} prenda${total - malas === 1 ? "" : "s"} volvieron al stock de ${nombreSucursal(nota.sucursal)}.` : "Ninguna prenda volvió al stock."}
                {malas > 0 ? ` ${malas} fallada${malas === 1 ? "" : "s"}: no vuelven al stock.` : ""} La nota no vence.
              </p>
            );
          })()}
          <button onClick={() => setAImprimir(true)}>Imprimir nota</button>
        </div>
      )}
      {nota && (
        <div className="solo-ticket" aria-hidden="true">
          <TicketNota nota={nota} />
        </div>
      )}
    </>
  );
}

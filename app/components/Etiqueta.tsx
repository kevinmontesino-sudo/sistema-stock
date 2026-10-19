"use client";
import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";
import { QRCodeSVG } from "qrcode.react";
import { empresa } from "@/lib/empresa.config";
import { pesos } from "@/lib/util";

export type PrecioEtiqueta = { nombre: string; valor: number };
export type DatosEtiqueta = { sku: string; nombre: string; precios: PrecioEtiqueta[]; marco?: boolean };

function Barras({ valor }: { valor: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    // Cada barra fina mide 2 puntos de la impresora (203 dpi = 8 puntos por mm), y el codigo queda
    // centrado en puntos enteros: asi las barras caen justo sobre la grilla y no salen borrosas.
    JsBarcode(svg, valor || "SKU", { format: "CODE128", displayValue: false, margin: 0, height: 40, width: 2 });
    const w = parseFloat(svg.getAttribute("width") ?? "0");
    const h = parseFloat(svg.getAttribute("height") ?? "0");
    const puntosEtiqueta = Math.round(empresa.etiquetaMm.ancho * 8);
    const izquierda = Math.max(0, Math.floor((puntosEtiqueta - w) / 2) - 16);
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.style.width = `${w / 8}mm`;
    svg.style.marginLeft = `${izquierda / 8}mm`;
  }, [valor]);
  return <svg ref={ref} className="barras" role="img" aria-label={`Código de barras ${valor}`} />;
}

export function Etiqueta({ sku, nombre, precios, marco }: DatosEtiqueta) {
  const barras = empresa.codigoEtiqueta === "code128";
  return (
    <div className={`${barras ? "etiqueta con-barras" : "etiqueta"}${marco ? " con-marco" : ""}`}>
      {barras ? <Barras valor={sku} /> : <QRCodeSVG value={sku || "SKU"} size={84} marginSize={0} />}
      <div className="etiqueta-texto">
        <div className="etiqueta-cab">
          <span className="etiqueta-sku">{sku}</span>
          <span className="etiqueta-nombre">{nombre}</span>
        </div>
        {precios.map((p) => (
          <div key={p.nombre} className="etiqueta-precio">{p.nombre}: {pesos(p.valor)}</div>
        ))}
      </div>
    </div>
  );
}

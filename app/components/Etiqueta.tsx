"use client";
import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";
import { QRCodeSVG } from "qrcode.react";
import { empresa } from "@/lib/empresa.config";
import { pesos } from "@/lib/util";

export type PrecioEtiqueta = { nombre: string; valor: number };
export type DatosEtiqueta = { sku: string; nombre: string; precios: PrecioEtiqueta[] };

function Barras({ valor }: { valor: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    JsBarcode(svg, valor || "SKU", { format: "CODE128", displayValue: false, margin: 6, height: 40, width: 2 });
    const w = svg.getAttribute("width");
    const h = svg.getAttribute("height");
    svg.setAttribute("viewBox", `0 0 ${parseFloat(w ?? "0")} ${parseFloat(h ?? "0")}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("preserveAspectRatio", "none");
  }, [valor]);
  return <svg ref={ref} className="barras" role="img" aria-label={`Código de barras ${valor}`} />;
}

export function Etiqueta({ sku, nombre, precios }: DatosEtiqueta) {
  const barras = empresa.codigoEtiqueta === "code128";
  return (
    <div className={barras ? "etiqueta con-barras" : "etiqueta"}>
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

"use client";
import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";
import { QRCodeSVG } from "qrcode.react";
import { empresa } from "@/lib/empresa.config";
import { textoPrecioEtiqueta } from "@/lib/util";

// lista: la linea "Lista $X · 3x$Y" (mas chica); destacado: el precio que se resalta (el de efectivo).
export type PrecioEtiqueta = { nombre: string; valor: number; cuotas?: number; lista?: boolean; destacado?: boolean };
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
    // Vista previa: con nombre largo (dos lineas) las barras bajan un poco, igual que en la etiqueta impresa.
    <div className={`${barras ? "etiqueta con-barras" : "etiqueta"}${marco ? " con-marco" : ""}${sku.length + nombre.length > 26 ? " nombre-largo" : ""}`}>
      {barras ? <Barras valor={sku} /> : <QRCodeSVG value={sku || "SKU"} size={84} marginSize={0} />}
      <div className="etiqueta-texto">
        <div className="etiqueta-cab">
          <span className="etiqueta-sku">{sku}</span>
          <span className="etiqueta-nombre">{nombre}</span>
        </div>
        {precios.map((p, i) => (
          // Tamanos de la vista previa: igual que en la impresa, la lista chica, los medios normales y el destacado grande.
          <div key={i} className="etiqueta-precio" style={{ fontSize: p.lista ? 8.5 : p.destacado ? 13 : undefined, lineHeight: 1.1 }}>{textoPrecioEtiqueta(p)}</div>
        ))}
      </div>
    </div>
  );
}

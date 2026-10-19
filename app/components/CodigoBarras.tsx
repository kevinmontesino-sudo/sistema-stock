"use client";
import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

// Codigo de barras Code128 con el texto abajo, para tickets y notas (el lector lo reconoce igual que las etiquetas).
export function CodigoBarras({ valor, ancho = "46mm" }: { valor: string; ancho?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    JsBarcode(svg, valor, { format: "CODE128", displayValue: true, fontSize: 16, height: 46, width: 2, margin: 0, textMargin: 2 });
    const w = parseFloat(svg.getAttribute("width") ?? "0");
    const h = parseFloat(svg.getAttribute("height") ?? "0");
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.style.width = ancho;
  }, [valor, ancho]);
  return <svg ref={ref} role="img" aria-label={`Código de barras ${valor}`} style={{ display: "block", margin: "6px auto" }} />;
}

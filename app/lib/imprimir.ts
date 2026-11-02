// Imprime con el tamano de pagina que corresponda (etiqueta o ticket).
// El @page se inyecta al momento de imprimir, asi etiquetas y tickets pueden tener tamanos distintos.
// Con "<ancho>mm auto" (tickets) se mide el ticket y se pide un papel de ese largo justo: Chrome no entiende "auto" y usaba
// una hoja larga entera, con lo que la impresora de rollo gastaba papel de mas y cortaba muy abajo.
function alturaTicketMm() {
  const el = document.querySelector<HTMLElement>(".solo-ticket");
  if (!el) return null;
  const antes = el.style.cssText;
  el.style.cssText = "display:block;position:absolute;visibility:hidden;left:-9999px;top:0";
  const px = el.getBoundingClientRect().height;
  el.style.cssText = antes;
  return px > 0 ? Math.ceil((px * 25.4) / 96) + 4 : null;
}

export function imprimir(tamano: string) {
  const auto = tamano.match(/^(\d+(?:\.\d+)?mm) auto$/);
  const alto = auto ? alturaTicketMm() : null;
  const estilo = document.createElement("style");
  estilo.textContent = `@page { size: ${auto && alto ? `${auto[1]} ${alto}mm` : tamano}; margin: 0; }`;
  document.head.appendChild(estilo);
  const quitar = () => {
    estilo.remove();
    window.removeEventListener("afterprint", quitar);
  };
  window.addEventListener("afterprint", quitar);
  window.print();
}

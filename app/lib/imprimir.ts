// Imprime con el tamano de pagina que corresponda (etiqueta o ticket).
// El @page se inyecta al momento de imprimir, asi etiquetas y tickets pueden tener tamanos distintos.
export function imprimir(tamano: string) {
  const estilo = document.createElement("style");
  estilo.textContent = `@page { size: ${tamano}; margin: 0; }`;
  document.head.appendChild(estilo);
  const quitar = () => {
    estilo.remove();
    window.removeEventListener("afterprint", quitar);
  };
  window.addEventListener("afterprint", quitar);
  window.print();
}

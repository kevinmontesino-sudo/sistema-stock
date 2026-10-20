export const empresa = {
  nombre: "X Menos Más Prendas",
  sucursales: [
    // color: la franja de arriba, para que siempre se note en que sucursal se esta trabajando.
    { id: "deposito", nombre: "Depósito", color: "#5b6470" },
    { id: "zelarrayan", nombre: "Zelarrayan", color: "#1f6f5c" },
    { id: "white", nombre: "White", color: "#7a3fa8" },
    { id: "sanlorenzo", nombre: "San Lorenzo", color: "#b5531c" },
  ],
  // Un envio que sigue sin confirmarse despues de estas horas se marca en naranja (en el destino y en el origen).
  avisoSinRecibirHoras: 24,
  tipos: [
    { codigo: "JEA", nombre: "Jean", alias: ["jean", "jeans"] },
    { codigo: "REM", nombre: "Remera", alias: ["remera", "remeras"] },
    { codigo: "MAL", nombre: "Malla", alias: ["malla", "mallas", "bikini", "bikinis", "enteriza", "enterizas", "traje de baño", "trikini"] },
    { codigo: "BUZ", nombre: "Buzo", alias: ["buzo", "buzos", "hoodie", "canguro"] },
    { codigo: "CAM", nombre: "Campera", alias: ["campera", "camperas"] },
    { codigo: "PAN", nombre: "Pantalón", alias: ["pantalon", "pantalones"] },
    { codigo: "SHO", nombre: "Short", alias: ["short", "shorts", "bermuda", "bermudas"] },
    { codigo: "OTR", nombre: "Otro", alias: [] as string[] },
  ],
  preciosFrecuentes: [9000, 17500, 22000, 30000],
  skuDigitos: 6,
  // Medios de pago cuyo precio se imprime en la etiqueta (los porcentajes se leen de la tabla medios_pago).
  etiquetaMedios: ["transferencia", "efectivo"],
  // Ultima linea de la etiqueta: "3 cuotas de $X" = precio con el recargo de este medio, dividido en N cuotas.
  etiquetaCuotas: { medio: "tarjeta", cantidad: 3 },
  codigoEtiqueta: "code128" as "code128" | "qr",
  // Medida del rollo de etiquetas, en milímetros. Ajustar a la impresora y rollo reales.
  etiquetaMm: { ancho: 50, alto: 30 },
  // Etiquetas: "directa" manda la etiqueta en el lenguaje de la impresora (TSPL) con QZ Tray; "ventana" usa la ventana de impresion del navegador.
  impresionEtiquetas: "servidor" as "directa" | "ventana" | "servidor",
  // Parte del nombre de la impresora de etiquetas tal como la ve el sistema (ej. "Xprinter XP-410B" o "Xprinter_XP_410B").
  impresoraEtiquetas: "410",
  // Ajustes TSPL (si las etiquetas salen del reves o la separacion no coincide, se cambian aca).
  // Modo "servidor": el sistema manda un PDF 50x30 con `lp` a esta cola, sin ventana (cola = nombre en CUPS, papel = codigo del PPD).
  servidor: { cola: "Xprinter_XP_410B", papel: "LB07", oscuridad: 11 },
  tspl: { direccion: 1, separacionMm: 3 },
  // Ancho del papel del ticket (rollo continuo). 80 mm para la XP-365B; 58 mm para impresoras de ticket chicas.
  ticketMm: { ancho: 80 },
};

export const DEPOSITO = empresa.sucursales[0].id;

export const LOCALES = empresa.sucursales.filter((s) => s.id !== DEPOSITO);

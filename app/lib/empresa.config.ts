export const empresa = {
  nombre: "Mi empresa",
  sucursales: [
    { id: "deposito", nombre: "Depósito" },
    { id: "zelarrayan", nombre: "Zelarrayan" },
    { id: "white", nombre: "White" },
    { id: "sanlorenzo", nombre: "San Lorenzo" },
  ],
  tipos: [
    { codigo: "JEA", nombre: "Jean", alias: ["jean", "jeans"] },
    { codigo: "REM", nombre: "Remera", alias: ["remera", "remeras"] },
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
  codigoEtiqueta: "code128" as "code128" | "qr",
  // Medida del rollo de etiquetas, en milímetros. Ajustar a la impresora y rollo reales.
  etiquetaMm: { ancho: 50, alto: 30 },
  // Ancho del papel del ticket (rollo continuo). 80 mm para la XP-365B; 58 mm para impresoras de ticket chicas.
  ticketMm: { ancho: 80 },
};

export const DEPOSITO = empresa.sucursales[0].id;

export const LOCALES = empresa.sucursales.filter((s) => s.id !== DEPOSITO);

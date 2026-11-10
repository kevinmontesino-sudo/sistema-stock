"use client";
import { useId, useState } from "react";

// Piezas de los informes. Reglas: una sola linea de color (el acento), barras finas con la punta redondeada, grilla casi invisible,
// valores solo donde importan (la barra mas alta y el detalle al pasar el mouse), y siempre una tabla debajo para leer todo.

export function Cifra({ titulo, valor, nota, grande }: { titulo: string; valor: string; nota?: string; grande?: boolean }) {
  return (
    <div className={`cifra ${grande ? "grande" : ""}`}>
      <p className="cifra-titulo">{titulo}</p>
      <p className="cifra-valor">{valor}</p>
      {nota && <p className="cifra-nota">{nota}</p>}
    </div>
  );
}

// Lista de barras horizontales, de mayor a menor, un solo color. Para comparar partes (locales, medios de pago, prendas).
export function BarrasH({ filas, vacio = "Sin datos en este período." }: { filas: { id: string; nombre: string; valor: number; texto: string; detalle?: string }[]; vacio?: string }) {
  const max = Math.max(0, ...filas.map((f) => f.valor));
  if (filas.length === 0) return <p className="aviso">{vacio}</p>;
  return (
    <ul className="barras-h">
      {filas.map((f) => (
        <li key={f.id}>
          <div className="barras-h-nombre">{f.nombre}</div>
          <div className="barras-h-valor">{f.texto}</div>
          <div className="barras-h-pista" aria-hidden="true"><div className="barras-h-barra" style={{ width: `${max > 0 ? Math.max(1.5, (f.valor / max) * 100) : 0}%` }} /></div>
          {f.detalle && <div className="barras-h-detalle">{f.detalle}</div>}
        </li>
      ))}
    </ul>
  );
}

// Columnas con hover: sirve para evolucion por dia/semana/mes y para horarios. Solo se rotulan el maximo y los extremos del eje.
export function Columnas({ datos, formato, alto = 170 }: { datos: { etiqueta: string; valor: number; detalle?: string }[]; formato: (n: number) => string; alto?: number }) {
  const [activa, setActiva] = useState<number | null>(null);
  const id = useId();
  const W = 640, H = alto, ARRIBA = 18, ABAJO = 22, IZQ = 4, DER = 4;
  const n = datos.length;
  if (n === 0) return <p className="aviso">Sin datos en este período.</p>;
  const max = Math.max(1, ...datos.map((d) => d.valor));
  const ranura = (W - IZQ - DER) / n;
  const ancho = Math.min(24, Math.max(3, ranura * 0.68));
  const util = H - ARRIBA - ABAJO;
  const iMax = datos.findIndex((d) => d.valor === max);
  const cada = Math.max(1, Math.ceil(n / 8));
  const x = (i: number) => IZQ + ranura * i + ranura / 2;
  const a = activa === null ? null : datos[activa];
  return (
    <div className="columnas" style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-labelledby={id} onMouseLeave={() => setActiva(null)}>
        <title id={id}>Gráfico de columnas. Máximo: {datos[iMax].etiqueta} con {formato(max)}.</title>
        <line x1={IZQ} x2={W - DER} y1={ARRIBA + util} y2={ARRIBA + util} className="eje" />
        <line x1={IZQ} x2={W - DER} y1={ARRIBA} y2={ARRIBA} className="grilla" />
        {datos.map((d, i) => {
          const h = d.valor > 0 ? Math.max(2, (d.valor / max) * util) : 0;
          const y = ARRIBA + util - h;
          const r = Math.min(4, ancho / 2, h);
          return (
            <g key={i}>
              {h > 0 && <path className={`col ${activa === i ? "viva" : ""}`} d={`M${x(i) - ancho / 2},${ARRIBA + util} V${y + r} Q${x(i) - ancho / 2},${y} ${x(i) - ancho / 2 + r},${y} H${x(i) + ancho / 2 - r} Q${x(i) + ancho / 2},${y} ${x(i) + ancho / 2},${y + r} V${ARRIBA + util} Z`} />}
              <rect x={IZQ + ranura * i} y={0} width={ranura} height={H - ABAJO} fill="transparent" tabIndex={0} aria-label={`${d.etiqueta}: ${formato(d.valor)}${d.detalle ? `, ${d.detalle}` : ""}`}
                onMouseEnter={() => setActiva(i)} onFocus={() => setActiva(i)} onBlur={() => setActiva(null)} />
              {(i % cada === 0 || (i === n - 1 && (n - 1) % cada >= Math.ceil(cada * 0.6))) && <text x={x(i)} y={H - 6} textAnchor="middle" className="eje-texto">{d.etiqueta}</text>}
            </g>
          );
        })}
        {d_valor(iMax, datos) > 0 && <text x={Math.min(Math.max(x(iMax), 40), W - 40)} y={ARRIBA - 5} textAnchor="middle" className="valor-max">{formato(max)}</text>}
      </svg>
      {a && activa !== null && (
        <div className="tip" style={{ left: `${Math.min(88, Math.max(12, (x(activa) / W) * 100))}%` }} role="status">
          <strong>{a.etiqueta}</strong> · {formato(a.valor)}{a.detalle && <span> · {a.detalle}</span>}
        </div>
      )}
    </div>
  );
}
const d_valor = (i: number, d: { valor: number }[]) => d[i]?.valor ?? 0;

// Los mismos numeros de un grafico, en tabla (para leer todo o copiar).
export function VerTabla({ encabezados, filas }: { encabezados: string[]; filas: (string | number)[][] }) {
  return (
    <details className="ver-tabla">
      <summary>Ver como tabla</summary>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead><tr>{encabezados.map((e, i) => <th key={i} className={i > 0 ? "der" : ""}>{e}</th>)}</tr></thead>
          <tbody>{filas.map((f, i) => <tr key={i}>{f.map((c, j) => <td key={j} className={j > 0 ? "der" : ""}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

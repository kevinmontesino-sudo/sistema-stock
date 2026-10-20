import { useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { SesionCtx } from "@/components/SesionContext";
import { DEPOSITO } from "./empresa.config";

const noop = () => () => {};
export function useMontado() {
  return useSyncExternalStore(noop, () => true, () => false);
}

const KEY = "stock:sucursal";
const listeners = new Set<() => void>();
export function useSucursal() {
  // Vendedores, encargados y deposito operan siempre en su sucursal (el servidor lo exige igual): no se puede cambiar.
  const fija = useContext(SesionCtx)?.sucursalFija ?? null;
  const id = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => localStorage.getItem(KEY) ?? DEPOSITO,
    () => DEPOSITO,
  );
  const set = (v: string) => {
    if (fija) return;
    localStorage.setItem(KEY, v);
    listeners.forEach((l) => l());
  };
  return [fija ?? id, set] as const;
}

// Opciones avanzadas (ajustar envios y demas): apagadas por defecto para que todo sea simple.
// Es una preferencia de esta computadora; quien quiera mas control la prende desde su nombre, arriba a la derecha.
const KEY_AVANZADO = "stock:avanzado";
const listenersAvanzado = new Set<() => void>();
export function useAvanzado() {
  const on = useSyncExternalStore(
    (cb) => {
      listenersAvanzado.add(cb);
      return () => listenersAvanzado.delete(cb);
    },
    () => { try { return localStorage.getItem(KEY_AVANZADO) === "1"; } catch { return false; } },
    () => false,
  );
  const set = (v: boolean) => {
    try { localStorage.setItem(KEY_AVANZADO, v ? "1" : "0"); } catch {}
    listenersAvanzado.forEach((l) => l());
  };
  return [on, set] as const;
}

import { useState } from "react";
export function useDebounced<T>(valor: T, ms = 220) {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return v;
}

// Ajuste guardado en este equipo (cada PC decide si imprime el ticket sola al cobrar).
const KEY_TICKET = "stock:autoticket";
const oyentesTicket = new Set<() => void>();
export function useAutoTicket() {
  const activo = useSyncExternalStore(
    (cb) => {
      oyentesTicket.add(cb);
      return () => oyentesTicket.delete(cb);
    },
    () => localStorage.getItem(KEY_TICKET) === "1",
    () => false,
  );
  const set = (v: boolean) => {
    localStorage.setItem(KEY_TICKET, v ? "1" : "0");
    oyentesTicket.forEach((l) => l());
  };
  return [activo, set] as const;
}

// Como imprime etiquetas esta PC: directo a la impresora (QZ Tray) o con la ventana del navegador.
const KEY_ETIQ = "stock:modoetiquetas";
const oyentesEtiq = new Set<() => void>();
export type ModoEtiquetas = "directa" | "ventana" | "servidor";
export function useModoEtiquetas(porDefecto: ModoEtiquetas) {
  const modo = useSyncExternalStore(
    (cb) => {
      oyentesEtiq.add(cb);
      return () => oyentesEtiq.delete(cb);
    },
    () => (localStorage.getItem(KEY_ETIQ) as ModoEtiquetas | null) ?? porDefecto,
    () => porDefecto,
  );
  const set = (v: ModoEtiquetas) => {
    localStorage.setItem(KEY_ETIQ, v);
    oyentesEtiq.forEach((l) => l());
  };
  return [modo, set] as const;
}

// Lector de codigos de barras: funciona como un teclado que escribe el codigo muy rapido y termina con Enter
// (o con Tab, segun como venga configurado). Se escucha en toda la pagina, salvo mientras se escribe en un campo.
export function useEscaner(alCodigo: (codigo: string) => void) {
  const buffer = useRef({ texto: "", t: 0 });
  const callback = useRef(alCodigo);
  useEffect(() => {
    callback.current = alCodigo;
  });
  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      const destino = (e.target as HTMLElement).tagName;
      if (destino === "INPUT" || destino === "TEXTAREA" || destino === "SELECT") return;
      const b = buffer.current;
      const ahora = Date.now();
      if (ahora - b.t > 100) b.texto = "";
      b.t = ahora;
      if (e.key === "Enter" || e.key === "Tab") {
        if (b.texto.length >= 3) {
          e.preventDefault(); // que no mueva el foco ni "apriete" el boton enfocado
          callback.current(b.texto);
        }
        b.texto = "";
      } else if (e.key.length === 1) {
        b.texto += e.key;
      }
    }
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []);
}

// Porcentajes del reparto automatico a los locales (por ejemplo 40 / 20 / 40), guardados en esta PC.
const KEY_PCT = "stock:repartopct";
const oyentesPct = new Set<() => void>();
export function usePorcentajesReparto() {
  const crudo = useSyncExternalStore(
    (cb) => {
      oyentesPct.add(cb);
      return () => oyentesPct.delete(cb);
    },
    () => localStorage.getItem(KEY_PCT) ?? "{}",
    () => "{}",
  );
  let pct: Record<string, string> = {};
  try { pct = JSON.parse(crudo); } catch { /* valor roto: se ignora */ }
  const set = (v: Record<string, string>) => {
    localStorage.setItem(KEY_PCT, JSON.stringify(v));
    oyentesPct.forEach((l) => l());
  };
  return [pct, set] as const;
}

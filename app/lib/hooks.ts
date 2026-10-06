import { useSyncExternalStore } from "react";
import { DEPOSITO } from "./empresa.config";

const noop = () => () => {};
export function useMontado() {
  return useSyncExternalStore(noop, () => true, () => false);
}

const KEY = "stock:sucursal";
const listeners = new Set<() => void>();
export function useSucursal() {
  const id = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => localStorage.getItem(KEY) ?? DEPOSITO,
    () => DEPOSITO,
  );
  const set = (v: string) => {
    localStorage.setItem(KEY, v);
    listeners.forEach((l) => l());
  };
  return [id, set] as const;
}

import { useEffect, useState } from "react";
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

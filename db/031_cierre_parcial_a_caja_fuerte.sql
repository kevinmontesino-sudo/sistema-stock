-- Cierre parcial: la plata que sale de la caja durante el dia y se GUARDA en la caja fuerte. Suma a lo que tendria que haber en la caja fuerte.
-- a_caja_fuerte = true solo en los cierres parciales nuevos; los retiros viejos quedan en false (no se sabe a donde fueron, no se cuentan).
-- Solo agrega una columna: no toca datos. Aplicar ANTES de desplegar; se puede correr mas de una vez.
alter table retiros_efectivo add column if not exists a_caja_fuerte boolean not null default false;

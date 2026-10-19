-- Reglas de devolucion definidas por el negocio:
--  * La nota de credito NO vence (vence_en queda solo como dato historico, ahora puede ser nulo).
--  * La devolucion se acepta hasta 15 dias despues de la compra (lo controla la app).
--  * Una prenda fallada no vuelve al stock: se registra cuantas unidades de cada renglon eran falladas.
alter table notas_credito alter column vence_en drop not null;
alter table nota_credito_items add column if not exists falladas integer not null default 0 check (falladas >= 0 and falladas <= cantidad);

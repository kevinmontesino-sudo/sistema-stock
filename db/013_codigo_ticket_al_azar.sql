-- Codigo de ticket NO secuencial. Antes el ticket mostraba el numero interno (V000123): cualquiera que comprara dos veces en el dia
-- podia calcular cuantas ventas hace el negocio. Ahora el ticket muestra V + 8 caracteres al azar; el id interno sigue existiendo
-- pero no se muestra ni se acepta para buscar una venta.
alter table ventas add column if not exists codigo text not null unique
  default ('V' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)));

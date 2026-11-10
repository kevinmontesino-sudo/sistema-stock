-- Producto unico: precios cargados a mano por medio de pago (ej. lista = transferencia = tarjeta 27.200, efectivo 19.000).
-- precios_medio = { "<medio_pago_id>": precio por unidad }. null = producto comun (los precios salen de los % de medios_pago).
-- Un producto unico siempre tiene su propio SKU: no se junta con otro del mismo nombre y precio.
begin;
alter table productos add column if not exists precios_medio jsonb;
drop index if exists productos_unico_activo;
create unique index productos_unico_activo on productos (tipo, nombre_norm, precio_lista) where activo and precios_medio is null;
commit;

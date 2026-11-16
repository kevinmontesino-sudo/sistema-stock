-- Promos por medio de pago: la promo solo vale si TODO el pago se hace con alguno de estos medios (ids de medios_pago).
-- Vacio = vale con cualquier medio (como hasta ahora). Las promos que ya existen quedan igual.
alter table promos add column if not exists medios text[] not null default '{}';

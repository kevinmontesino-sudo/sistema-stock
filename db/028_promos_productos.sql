-- Promos por producto: una promo puede valer solo para ciertos SKU (skus) y puede ser "a mano" (manual): no se aplica sola, el vendedor
-- la toca en la fila de la prenda en la caja (para cuando solo algunos talles entran y el sistema no sabe el talle).
-- Una promo manual es de tipo porcentaje o precio, y tiene que tener productos. Aplicar ANTES de desplegar; se puede correr mas de una vez.
alter table promos add column if not exists skus text[] not null default '{}';
alter table promos add column if not exists manual boolean not null default false;
alter table promos drop constraint if exists promos_manual_reglas;
alter table promos add constraint promos_manual_reglas check (not manual or (tipo in ('porcentaje', 'precio') and cardinality(skus) > 0 and n is null));
-- Lo que se vendio con una promo a mano: precio_lista del renglon queda con el precio ya rebajado (asi devoluciones y caja cierran solas)
-- y aca queda el precio original y que promo fue.
alter table venta_items add column if not exists precio_original integer;
alter table venta_items add column if not exists promo_manual_id bigint references promos(id);
alter table venta_items add column if not exists promo_manual_nombre text;

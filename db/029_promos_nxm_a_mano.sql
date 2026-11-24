-- Promo "a mano" tambien puede ser NxM (ej. 3x2 solo en los jeans talle 36): el vendedor marca en la fila de cada prenda que entra
-- y el descuento se calcula entre las marcadas. Solo se suelta la regla que lo prohibia; no toca datos. Aplicar ANTES de desplegar; se puede correr mas de una vez.
alter table promos drop constraint if exists promos_manual_reglas;
alter table promos add constraint promos_manual_reglas check (not manual or (tipo in ('porcentaje', 'precio', 'nxm') and cardinality(skus) > 0 and (tipo = 'nxm' or n is null)));

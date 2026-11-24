-- Promo "a mano" sin lista de productos: el boton "Aplicar" sale en cualquier prenda de la caja (o de las categorias elegidas) y el vendedor decide
-- en cual la aplica. Solo se suelta la regla que exigia productos; no toca datos. Aplicar ANTES de desplegar; se puede correr mas de una vez.
alter table promos drop constraint if exists promos_manual_reglas;
alter table promos add constraint promos_manual_reglas check (not manual or (tipo in ('porcentaje', 'precio', 'nxm') and (tipo = 'nxm' or n is null)));

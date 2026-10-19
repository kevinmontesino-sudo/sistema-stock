-- Preparacion para varias cajas al mismo tiempo (mas de 100 ventas por dia por local).
-- clave: identifica un intento de cobro; si el mismo intento llega dos veces (reintento tras un corte), no se duplica la venta.
alter table ventas add column if not exists clave text;
create unique index if not exists ventas_clave_idx on ventas (clave) where clave is not null;
-- La caja de hoy y los reportes filtran por local y fecha.
create index if not exists ventas_suc_fecha_idx on ventas (sucursal_id, creado_en);
create index if not exists movimientos_venta_idx on movimientos (venta_id) where venta_id is not null;

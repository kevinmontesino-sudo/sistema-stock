-- Baja logica de productos: "eliminar" oculta el producto pero conserva el historial de ventas y movimientos.
-- La unicidad (tipo, nombre, precio) pasa a valer solo entre productos activos, asi se puede volver a cargar uno dado de baja.

begin;

alter table productos add column activo boolean not null default true;
alter table productos add column eliminado_en timestamptz;

alter table productos drop constraint productos_tipo_nombre_norm_precio_lista_key;
create unique index productos_unico_activo on productos (tipo, nombre_norm, precio_lista) where activo;

commit;

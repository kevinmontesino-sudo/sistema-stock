-- Comisiones: quien vendio cada ticket. Los vendedores son personas (no cuentas): una persona puede cobrar en cualquier sucursal,
-- pero la comision se calcula por la sucursal a la que PERTENECE (sucursal_id). La venta guarda quien fue y de que sucursal era en ese momento.
create table if not exists vendedores (
  id          bigserial primary key,
  nombre      text not null check (length(btrim(nombre)) between 2 and 80),
  sucursal_id text not null references sucursales(id),
  activo      boolean not null default true,
  ficha_id    integer,                       -- por si despues se enlaza con la ficha
  creado_en   timestamptz not null default now()
);
create unique index if not exists vendedores_nombre_suc_idx on vendedores (lower(btrim(nombre)), sucursal_id);

alter table ventas
  add column if not exists vendedor_id          bigint references vendedores(id),
  add column if not exists vendedor_nombre      text,
  add column if not exists vendedor_sucursal_id text references sucursales(id);
create index if not exists ventas_vendedor_idx on ventas (vendedor_id, creado_en);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'stock_web') then
    grant select, insert, update on vendedores to stock_web;
    grant usage, select on all sequences in schema public to stock_web;
  end if;
end;
$$;

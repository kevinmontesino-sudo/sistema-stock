-- Compras de empleados: cada prenda que un empleado se lleva baja del stock y se carga a su cuenta corriente en el sistema de ficha.
-- Esta tabla es la cola de envio: si la ficha no responde, queda 'pendiente' y se reenvia sola (la referencia evita cargarla dos veces).
create table if not exists consumos_empleado (
  id               bigint generated always as identity primary key,
  codigo           text not null,                       -- codigo de la compra (agrupa los renglones)
  referencia       text not null unique,                -- se manda a la ficha: un reintento no duplica el consumo
  empleado_id      integer not null,                    -- id del empleado en la ficha
  empleado_nombre  text not null,                       -- copia del nombre, por si cambia en la ficha
  sku              text not null references productos(sku),
  cantidad         integer not null check (cantidad > 0),
  sucursal_id      text not null references sucursales(id),   -- de que local salio el stock
  monto            integer not null check (monto > 0),  -- lo que se carga a la cuenta (precio de efectivo x cantidad)
  detalle          text not null,
  estado           text not null default 'pendiente' check (estado in ('pendiente', 'enviado', 'error')),
  intentos         integer not null default 0,
  ultimo_error     text,
  creado_en        timestamptz not null default now(),
  enviado_en       timestamptz,
  usuario_id       bigint references usuarios(id)
);
create index if not exists consumos_empleado_estado_idx on consumos_empleado (estado) where estado <> 'enviado';
create index if not exists consumos_empleado_empleado_idx on consumos_empleado (empleado_id, creado_en desc);
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'stock_web') then
    grant select, insert, update on consumos_empleado to stock_web;
    grant usage, select on all sequences in schema public to stock_web;
  end if;
end;
$$;

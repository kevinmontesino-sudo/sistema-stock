-- Tickets de regalo: una compra de la que se imprimio el ticket de regalo se puede cambiar hasta 30 dias (en vez de 15).
-- Una fila por venta (se inserta y no se edita). Las ventas sin fila siguen con el plazo de siempre.
create table if not exists ventas_regalo (
  venta_id    bigint primary key references ventas(id),
  creado_en   timestamptz not null default now(),
  usuario_id  bigint references usuarios(id)
);
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'stock_web') then
    grant select, insert on ventas_regalo to stock_web;
  end if;
end;
$$;

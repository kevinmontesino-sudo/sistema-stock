-- 1) Anular una venta (ticket equivocado): la venta NO se borra ni se edita (los registros contables son inmutables).
--    Se agrega una fila en ventas_anuladas con el motivo y quien la anulo; el stock vuelve y los informes/cierre la dejan afuera.
-- 2) De donde sale el stock de cada renglon vendido (venta_items.stock_de): el deposito puede vender prendas que en realidad
--    estan en San Lorenzo. Si es null, salio de la sucursal de la venta (todas las ventas anteriores).
-- Se corre ANTES de desplegar el codigo. Es seguro correrlo mas de una vez.

-- Un valor nuevo de enum no se puede usar en la misma transaccion en que se agrega: va suelto, antes del bloque.
alter type tipo_movimiento add value if not exists 'anulacion';

begin;

create table if not exists ventas_anuladas (
  venta_id   bigint primary key references ventas(id),
  usuario_id bigint references usuarios(id),
  motivo     text not null check (length(btrim(motivo)) >= 5),
  creado_en  timestamptz not null default now()
);
create index if not exists ventas_anuladas_fecha_idx on ventas_anuladas (creado_en);

alter table venta_items add column if not exists stock_de text references sucursales(id);

-- Una anulacion no se deshace ni se borra (igual que las ventas): si hubo un error, se vuelve a vender.
drop trigger if exists ventas_anuladas_inmutable on ventas_anuladas;
create trigger ventas_anuladas_inmutable before update or delete on ventas_anuladas
  for each row execute function bloquear_modificacion();
drop trigger if exists ventas_anuladas_sin_vaciar on ventas_anuladas;
create trigger ventas_anuladas_sin_vaciar before truncate on ventas_anuladas
  for each statement execute function bloquear_vaciado();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'stock_web') then
    grant select, insert on ventas_anuladas to stock_web;
  end if;
end;
$$;

commit;

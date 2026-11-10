-- Cierre de caja diario por sucursal: lo que el sistema dice que se cobro vs. lo que el local cuenta.
-- Un cierre por local y por dia; una vez hecho NO se edita ni se borra (para corregir, la oficina lo ve en el informe de control).
create table if not exists cierres_caja (
  id               bigint generated always as identity primary key,
  sucursal_id      text not null references sucursales(id),
  dia              date not null,                       -- dia calendario de Argentina que se cierra
  creado_en        timestamptz not null default now(),
  usuario_id       bigint references usuarios(id),
  cerrado_por      text not null,                       -- copia del nombre, por si la cuenta cambia
  fondo_inicial    integer not null default 0 check (fondo_inicial >= 0),   -- efectivo con el que se abrio la caja
  retiros          integer not null default 0 check (retiros >= 0),         -- plata sacada de la caja en el dia (gastos, depositos)
  retiros_motivo   text,
  ventas           integer not null,
  unidades         integer not null,
  esperado         jsonb not null,                      -- {medio_id: monto} cobrado segun el sistema
  contado          jsonb not null,                      -- {medio_id: monto} lo que conto el local (efectivo siempre; otros si quiso)
  efectivo_esperado integer not null,                   -- fondo + cobrado en efectivo - retiros
  efectivo_contado integer not null check (efectivo_contado >= 0),
  diferencia       integer not null,                    -- contado - esperado, solo efectivo (negativo = falta plata)
  notas_emitidas   integer not null default 0,
  notas_monto      integer not null default 0,
  observaciones    text,
  unique (sucursal_id, dia)
);
create index if not exists cierres_caja_dia_idx on cierres_caja (dia, sucursal_id);

create or replace function proteger_cierres_caja() returns trigger language plpgsql as $$
begin
  if current_setting('app.mantenimiento', true) = 'on' then
    return coalesce(new, old);
  end if;
  raise exception 'Los cierres de caja no se editan ni se borran';
end;
$$;
drop trigger if exists cierres_caja_inmutable on cierres_caja;
create trigger cierres_caja_inmutable before update or delete on cierres_caja
  for each row execute function proteger_cierres_caja();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'stock_web') then
    grant select, insert on cierres_caja to stock_web;
    grant usage, select on all sequences in schema public to stock_web;
  end if;
end;
$$;

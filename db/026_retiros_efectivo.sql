-- Retiros de efectivo: todo movimiento de plata que sale de un local queda anotado con quien se la lleva.
--  origen 'caja'        = cierre parcial: se saca plata de la caja durante el dia (se descuenta sola del cierre diario de ese dia).
--  origen 'caja_fuerte' = se saca plata de la caja fuerte del local (baja lo que "tendria que haber" en ella).
-- destino: a donde va la plata (ej. Deposito, Banco). Reemplaza a retiros_caja_fuerte (025), que todavia no tiene datos.
-- Aplicar ANTES de desplegar; se puede correr mas de una vez.
do $$
begin
  if to_regclass('public.retiros_caja_fuerte') is not null and to_regclass('public.retiros_efectivo') is null then
    alter table retiros_caja_fuerte rename to retiros_efectivo;
  end if;
end;
$$;
create table if not exists retiros_efectivo (
  id             bigint generated always as identity primary key,
  sucursal_id    text not null references sucursales(id),
  creado_en      timestamptz not null default now(),
  monto          integer not null check (monto > 0),
  retirado_por   text not null check (length(btrim(retirado_por)) between 2 and 80),
  motivo         text check (motivo is null or length(motivo) <= 200),
  registrado_por text not null,
  usuario_id     bigint references usuarios(id)
);
alter table retiros_efectivo add column if not exists origen  text not null default 'caja_fuerte';
alter table retiros_efectivo add column if not exists destino text check (destino is null or length(destino) <= 60);
alter table retiros_efectivo drop constraint if exists retiros_efectivo_origen_check;
alter table retiros_efectivo add constraint retiros_efectivo_origen_check check (origen in ('caja', 'caja_fuerte'));
create index if not exists retiros_efectivo_suc_idx on retiros_efectivo (sucursal_id, creado_en);

create or replace function proteger_retiros_efectivo() returns trigger language plpgsql as $$
begin
  if current_setting('app.mantenimiento', true) = 'on' then
    return coalesce(new, old);
  end if;
  raise exception 'Los retiros de efectivo no se editan ni se borran';
end;
$$;
drop trigger if exists retiros_caja_fuerte_inmutable on retiros_efectivo;
drop trigger if exists retiros_efectivo_inmutable on retiros_efectivo;
create trigger retiros_efectivo_inmutable before update or delete on retiros_efectivo
  for each row execute function proteger_retiros_efectivo();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'stock_web') then
    grant select, insert on retiros_efectivo to stock_web;
    grant usage, select on all sequences in schema public to stock_web;
  end if;
end;
$$;

-- Caja fuerte de la empresa: retiros de efectivo (quien se llevo la plata y quien lo registro).
-- Lo que entra a la caja fuerte sale de los cierres de caja (efectivo contado - lo que se deja para el vuelto); aca se anota lo que SALE.
-- Registro inmutable (no se edita ni se borra; un error se corrige con un movimiento aparte). Aplicar ANTES de desplegar; se puede correr mas de una vez.
create table if not exists retiros_caja_fuerte (
  id            bigint generated always as identity primary key,
  sucursal_id   text not null references sucursales(id),
  creado_en     timestamptz not null default now(),
  monto         integer not null check (monto > 0),
  retirado_por  text not null check (length(btrim(retirado_por)) between 2 and 80),   -- quien se llevo la plata
  motivo        text check (motivo is null or length(motivo) <= 200),
  registrado_por text not null,                                                      -- quien lo cargo en el sistema (copia del nombre)
  usuario_id    bigint references usuarios(id)
);
create index if not exists retiros_caja_fuerte_idx on retiros_caja_fuerte (sucursal_id, creado_en);

create or replace function proteger_retiros_caja_fuerte() returns trigger language plpgsql as $$
begin
  if current_setting('app.mantenimiento', true) = 'on' then
    return coalesce(new, old);
  end if;
  raise exception 'Los retiros de la caja fuerte no se editan ni se borran';
end;
$$;
drop trigger if exists retiros_caja_fuerte_inmutable on retiros_caja_fuerte;
create trigger retiros_caja_fuerte_inmutable before update or delete on retiros_caja_fuerte
  for each row execute function proteger_retiros_caja_fuerte();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'stock_web') then
    grant select, insert on retiros_caja_fuerte to stock_web;
    grant usage, select on all sequences in schema public to stock_web;
  end if;
end;
$$;

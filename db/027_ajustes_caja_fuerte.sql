-- Conteo de la caja fuerte: el admin cuenta lo que hay de verdad y el sistema guarda la diferencia como ajuste (positivo o negativo).
-- Sirve para arrancar de cero (o corregir) sin tocar los cierres. No se edita ni se borra. Aplicar ANTES de desplegar; se puede correr mas de una vez.
create table if not exists ajustes_caja_fuerte (
  id             bigint generated always as identity primary key,
  sucursal_id    text not null references sucursales(id),
  creado_en      timestamptz not null default now(),
  monto          integer not null check (monto <> 0),
  contado        integer not null check (contado >= 0),
  motivo         text check (motivo is null or length(motivo) <= 200),
  registrado_por text not null,
  usuario_id     bigint references usuarios(id)
);
create index if not exists ajustes_caja_fuerte_suc_idx on ajustes_caja_fuerte (sucursal_id, creado_en);
create or replace function proteger_ajustes_caja_fuerte() returns trigger language plpgsql as $$
begin
  if current_setting('app.mantenimiento', true) = 'on' then return coalesce(new, old); end if;
  raise exception 'Los conteos de la caja fuerte no se editan ni se borran';
end;
$$;
drop trigger if exists ajustes_caja_fuerte_inmutable on ajustes_caja_fuerte;
create trigger ajustes_caja_fuerte_inmutable before update or delete on ajustes_caja_fuerte
  for each row execute function proteger_ajustes_caja_fuerte();
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'stock_web') then
    grant select, insert on ajustes_caja_fuerte to stock_web;
    grant usage, select on all sequences in schema public to stock_web;
  end if;
end;
$$;

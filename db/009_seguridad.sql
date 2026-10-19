-- Seguridad: login con roles, sesiones, doble verificacion (TOTP), intentos de login, auditoria
-- y proteccion de los registros contables (las ventas y su historial no se editan ni se borran).
--
-- Roles (rol_usuario): admin, encargado (jefe de un local), vendedor (cajero de un local), deposito.
-- El valor 'encargado' se agrega aparte (un valor nuevo de enum no se puede usar en la misma transaccion).

alter table usuarios add column if not exists totp_secreto        text;       -- cifrado con APP_KEY (AES-256-GCM)
alter table usuarios add column if not exists totp_activo         boolean not null default false;
alter table usuarios add column if not exists totp_ultimo_paso    bigint;     -- evita reutilizar un codigo ya usado
alter table usuarios add column if not exists debe_cambiar_clave  boolean not null default false;
alter table usuarios add column if not exists clave_cambiada_en   timestamptz;
alter table usuarios add column if not exists ultimo_login        timestamptz;

-- Sesiones en la base: el navegador solo guarda un token al azar; aca queda su huella (sha256), nunca el token.
create table if not exists sesiones (
  id               bigint generated always as identity primary key,
  token_hash       text not null unique,
  usuario_id       bigint not null references usuarios(id) on delete cascade,
  fase             text not null check (fase in ('2fa_pendiente', '2fa_alta', 'activa')),
  creado_en        timestamptz not null default now(),
  expira_en        timestamptz not null,
  ultima_actividad timestamptz not null default now(),
  ip               text,
  user_agent       text
);
create index if not exists sesiones_usuario_idx on sesiones (usuario_id);
create index if not exists sesiones_expira_idx on sesiones (expira_en);

-- Intentos de login (para limitar los fallidos por usuario y por IP).
create table if not exists intentos_login (
  id          bigint generated always as identity primary key,
  creado_en   timestamptz not null default now(),
  email_norm  text not null,
  ip          text,
  ok          boolean not null
);
create index if not exists intentos_login_email_idx on intentos_login (email_norm, creado_en);
create index if not exists intentos_login_ip_idx on intentos_login (ip, creado_en);

-- Auditoria: quien hizo que y cuando, con el valor anterior y el nuevo. Solo se agrega, nunca se modifica.
create table if not exists auditoria (
  id            bigint generated always as identity primary key,
  creado_en     timestamptz not null default now(),
  usuario_id    bigint references usuarios(id),
  usuario_email text,
  accion        text not null,
  detalle       jsonb not null default '{}'::jsonb,
  ip            text
);
create index if not exists auditoria_fecha_idx on auditoria (creado_en desc);
create index if not exists auditoria_accion_idx on auditoria (accion, creado_en desc);
create index if not exists auditoria_usuario_idx on auditoria (usuario_id, creado_en desc);

-- Registros contables inmutables. Solo se puede tocar con app.mantenimiento = 'on'
-- (uso excepcional y manual, por ejemplo limpiar datos de prueba antes de arrancar).
create or replace function bloquear_modificacion() returns trigger language plpgsql as $$
begin
  if current_setting('app.mantenimiento', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'Operacion no permitida (% sobre %): los registros contables no se modifican ni se borran. Las correcciones se hacen con notas de credito.', tg_op, tg_table_name
    using errcode = '42501';
end;
$$;

create or replace function bloquear_vaciado() returns trigger language plpgsql as $$
begin
  if current_setting('app.mantenimiento', true) = 'on' then return null; end if;
  raise exception 'Operacion no permitida (TRUNCATE sobre %)', tg_table_name using errcode = '42501';
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['ventas', 'venta_items', 'venta_pagos', 'nota_credito_items', 'movimientos', 'cargas', 'auditoria'] loop
    execute format('drop trigger if exists %I on %I', t || '_inmutable', t);
    execute format('create trigger %I before update or delete on %I for each row execute function bloquear_modificacion()', t || '_inmutable', t);
    execute format('drop trigger if exists %I on %I', t || '_sin_vaciar', t);
    execute format('create trigger %I before truncate on %I for each statement execute function bloquear_vaciado()', t || '_sin_vaciar', t);
  end loop;
end;
$$;

-- Las notas de credito solo pueden cambiar su saldo (se va usando); nada mas, y no se borran.
create or replace function proteger_notas_credito() returns trigger language plpgsql as $$
begin
  if current_setting('app.mantenimiento', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Operacion no permitida: las notas de credito no se borran' using errcode = '42501';
  end if;
  if new.id <> old.id or new.codigo <> old.codigo or new.venta_id <> old.venta_id or new.sucursal_id <> old.sucursal_id
     or new.creado_en <> old.creado_en or new.monto_inicial <> old.monto_inicial or new.ajuste_pct <> old.ajuste_pct
     or new.saldo > old.saldo or new.saldo < 0 then
    raise exception 'Operacion no permitida: de una nota de credito solo puede bajar el saldo' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists notas_credito_protegida on notas_credito;
create trigger notas_credito_protegida before update or delete on notas_credito for each row execute function proteger_notas_credito();
drop trigger if exists notas_credito_sin_vaciar on notas_credito;
create trigger notas_credito_sin_vaciar before truncate on notas_credito for each statement execute function bloquear_vaciado();

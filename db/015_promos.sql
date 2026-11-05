-- PROMOS por local y por fechas, y DESCUENTO ESPECIAL de un encargado (con motivo y quien lo autorizo).
-- Las promos las crean solo los administradores: desde el sistema (Oficina > Promos) o por la API con una llave de alcance "promos".
-- En la caja se aplican solas al escanear: el cajero no elige nada. Nunca se acumulan: si hay varias, se aplica la que mas descuenta.
--
-- Tres tipos:
--   nxm         lleva n, paga m (3x2, 2x1, 4x3). Las que no se pagan son las mas baratas.
--   porcentaje  % de descuento sobre el precio de lista (hasta 50).
--   precio      cada prenda a $precio. Con n: solo llevando n o mas (docena mayorista). Sirve para ferias: "todo a $1.000",
--               "buzos a $4.500 c/u". Nunca sube un precio: si la prenda vale menos, queda a su precio.
-- Opciones: descuento_efectivo (si ademas corre el -20% de efectivo; la tarjeta siempre lleva su recargo) y sin_cambio
-- (las prendas que entran en la promo quedan sin cambio: ferias de saldos).
-- Se puede correr de nuevo sin problema (todo es "if not exists" / se reemplazan los controles).

create table if not exists promos (
  id          bigint generated always as identity primary key,
  nombre      text not null check (length(nombre) between 2 and 60),
  tipo        text not null,
  n           integer,
  m           integer,
  pct         numeric(5,2),
  sucursales  text[] not null default '{}',          -- locales donde vale; vacio = todos
  tipos       text[] not null default '{}',          -- categorias de prenda (codigo de tipos); vacio = todas
  desde       date not null,                         -- fechas de Argentina, ambas incluidas
  hasta       date not null,
  activa      boolean not null default true,
  origen      text not null default 'sistema',       -- 'sistema' o 'api:<nombre de la llave>'
  creado_por  bigint references usuarios(id),
  creado_en   timestamptz not null default now(),
  check (hasta >= desde)
);
alter table promos add column if not exists precio integer;
alter table promos add column if not exists descuento_efectivo boolean not null default true;
alter table promos add column if not exists sin_cambio boolean not null default false;
alter table promos drop constraint if exists promos_tipo_check;
alter table promos drop constraint if exists promos_check1;
alter table promos drop constraint if exists promos_reglas;
alter table promos add constraint promos_reglas check (
     (tipo = 'nxm' and n between 2 and 10 and m between 1 and n - 1 and pct is null and precio is null)
  or (tipo = 'porcentaje' and pct > 0 and pct <= 50 and n is null and m is null and precio is null)
  or (tipo = 'precio' and precio > 0 and precio < 10000000 and pct is null and m is null and (n is null or n between 2 and 100))
);
create index if not exists promos_fechas_idx on promos (hasta, desde) where activa;

-- La venta guarda que promo uso y cuanto desconto (descuento_promo ya existia). Copia del nombre: cambiar la promo despues no altera tickets.
alter table ventas add column if not exists promo_id bigint references promos(id);
alter table ventas add column if not exists promo_nombre text;
-- Descuento especial: lo hace un encargado con motivo y nombre de quien lo autorizo. Lo ven los administradores en Oficina > Promos.
alter table ventas add column if not exists especial_pct numeric(5,2);
alter table ventas add column if not exists especial_motivo text;
alter table ventas add column if not exists especial_autorizo text;
-- Prendas vendidas en una promo "sin cambio" (feria de saldos): no se aceptan en devolucion.
alter table venta_items add column if not exists sin_cambio boolean not null default false;

-- Llaves de la API: ademas de "informes" (solo lectura) existe "promos" (lee informes y administra promos).
alter table tokens_api drop constraint if exists tokens_api_alcance_check;
alter table tokens_api add constraint tokens_api_alcance_check check (alcance in ('informes', 'promos'));

-- Permisos del usuario de la aplicacion (si ya existe). Las promos se crean y se desactivan; nunca se borran.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'stock_web') then
    grant select, insert, update on promos to stock_web;
    grant usage, select on all sequences in schema public to stock_web;
  end if;
end;
$$;

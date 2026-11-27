-- Cuentas de clientes mayoristas del Deposito (venta a cuenta / fiado). Cada cliente es del vendedor que le vendio (Santiago, Mayra, Tomas).
-- La deuda se lleva en "valor de lista" (ya con Curva Plus) y se muestra en pesos de cada medio. El vendedor comisiona (0,5%) cuando el cliente PAGA.
-- Los movimientos NO se editan ni se borran (como ventas, cierres y retiros). Aplicar ANTES de desplegar; se puede correr mas de una vez.

create table if not exists clientes_mayoristas (
  id           bigint generated always as identity primary key,
  nombre       text not null check (length(btrim(nombre)) between 2 and 80),
  telefono     text check (telefono is null or length(telefono) <= 40),
  nota         text check (nota is null or length(nota) <= 300),
  vendedor_id  bigint not null references vendedores(id),      -- dueno del cliente: el vendedor que le vende (comisiona sus cobros)
  nivel_precio text not null default 'curva_plus' check (nivel_precio in ('curva_plus', 'lista')),
  limite       integer check (limite is null or limite >= 0),   -- deuda maxima en valor de lista (null = sin limite)
  activo       boolean not null default true,
  creado_en    timestamptz not null default now(),
  creado_por   text not null,
  usuario_id   bigint references usuarios(id)
);
create unique index if not exists clientes_mayoristas_nombre_idx on clientes_mayoristas (lower(btrim(nombre)));
create index if not exists clientes_mayoristas_vendedor_idx on clientes_mayoristas (vendedor_id);

-- Medio "A cuenta": la venta a cuenta no es plata cobrada (no entra a la caja ni al cobrado de los informes). No se ofrece en la caja.
insert into medios_pago (id, nombre, ajuste_pct, activo) values ('a_cuenta', 'A cuenta', 0, false) on conflict (id) do nothing;

alter table ventas
  add column if not exists cliente_mayorista_id bigint references clientes_mayoristas(id),
  add column if not exists medio_acordado       text references medios_pago(id);
create index if not exists ventas_cliente_mayorista_idx on ventas (cliente_mayorista_id) where cliente_mayorista_id is not null;

create table if not exists cuenta_movimientos (
  id          bigint generated always as identity primary key,
  cliente_id  bigint not null references clientes_mayoristas(id),
  creado_en   timestamptz not null default now(),
  tipo        text not null check (tipo in ('venta', 'pago', 'devolucion', 'anulacion', 'ajuste')),
  valor_lista integer not null check (valor_lista <> 0),        -- + suma deuda / - baja deuda, en valor de lista (ya con Curva Plus)
  monto       integer not null default 0 check (monto >= 0),     -- pesos reales de la operacion en su medio (venta: total acordado; pago: lo que entro)
  medio_id    text references medios_pago(id),                   -- medio acordado (venta) o con el que se pago (pago)
  sucursal_id text references sucursales(id),
  venta_id    bigint references ventas(id),
  vendedor_id bigint not null references vendedores(id),         -- dueno del cliente en ese momento (a quien comisiona)
  comision    integer not null default 0,                        -- pesos de comision de ESTE movimiento (solo pagos)
  comision_pct numeric(6,3),
  motivo      text check (motivo is null or length(motivo) <= 200),
  autorizo    text check (autorizo is null or length(autorizo) <= 80),
  registrado_por text not null,
  usuario_id  bigint references usuarios(id)
);
create index if not exists cuenta_movimientos_cliente_idx on cuenta_movimientos (cliente_id, creado_en);
create index if not exists cuenta_movimientos_dia_idx on cuenta_movimientos (sucursal_id, creado_en) where tipo = 'pago';
create index if not exists cuenta_movimientos_vendedor_idx on cuenta_movimientos (vendedor_id, creado_en);

create or replace function proteger_cuenta_movimientos() returns trigger language plpgsql as $$
begin
  if current_setting('app.mantenimiento', true) = 'on' then return coalesce(new, old); end if;
  raise exception 'Los movimientos de las cuentas de clientes no se editan ni se borran';
end;
$$;
drop trigger if exists cuenta_movimientos_inmutable on cuenta_movimientos;
create trigger cuenta_movimientos_inmutable before update or delete on cuenta_movimientos
  for each row execute function proteger_cuenta_movimientos();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'stock_web') then
    grant select, insert, update on clientes_mayoristas to stock_web;
    grant select, insert on cuenta_movimientos to stock_web;
    grant usage, select on all sequences in schema public to stock_web;
  end if;
end;
$$;

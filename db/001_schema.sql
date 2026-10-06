-- Sistema de stock: esquema inicial (PostgreSQL 14+)
-- Se aplica una sola vez sobre una base vacia. Los cambios futuros van en archivos nuevos (002_..., 003_...).

begin;

-- Sucursales (el deposito es una sucursal mas, marcada como tal)
create table sucursales (
  id           text primary key,
  nombre       text not null,
  es_deposito  boolean not null default false,
  activa       boolean not null default true
);

-- Tipos de producto: definen el prefijo del SKU (JEA, REM, ...)
create table tipos (
  codigo  char(3) primary key,
  nombre  text not null,
  alias   text[] not null default '{}'
);

create type rol_usuario as enum ('admin', 'deposito', 'vendedor');

create table usuarios (
  id             bigint generated always as identity primary key,
  nombre         text not null,
  email          text not null unique,
  password_hash  text not null,
  rol            rol_usuario not null,
  sucursal_id    text references sucursales(id),
  activo         boolean not null default true,
  creado_en      timestamptz not null default now()
);

-- Un producto = un modelo a un precio de lista. Las prendas iguales comparten SKU.
create table productos (
  sku          text primary key,
  tipo         char(3) not null references tipos(codigo),
  nombre       text not null,
  nombre_norm  text not null,                 -- minusculas, sin tildes, sin espacios dobles
  precio_lista integer not null check (precio_lista > 0),
  foto_url     text,
  creado_en    timestamptz not null default now(),
  creado_por   bigint references usuarios(id),
  unique (tipo, nombre_norm, precio_lista)
);
create index productos_nombre_idx on productos (nombre_norm text_pattern_ops);

-- Ultimo numero usado por tipo, para generar el SKU de forma atomica
create table contadores_sku (
  tipo    char(3) primary key references tipos(codigo),
  ultimo  integer not null default 0
);

-- Stock por producto y sucursal. Puede quedar negativo a proposito (avisa un descuadre).
create table stock (
  sku          text not null references productos(sku),
  sucursal_id  text not null references sucursales(id),
  cantidad     integer not null default 0,
  primary key (sku, sucursal_id)
);

-- Cada carga en deposito (de aca sale "ing 02/10" y la historia de ingresos por producto)
create table cargas (
  id          bigint generated always as identity primary key,
  sku         text not null references productos(sku),
  cantidad    integer not null check (cantidad > 0),
  usuario_id  bigint references usuarios(id),
  creado_en   timestamptz not null default now()
);
create index cargas_sku_idx on cargas (sku, creado_en);

create type tipo_movimiento as enum ('carga', 'envio', 'traslado', 'ingreso', 'venta', 'deshacer', 'ajuste');

-- Historial de todo lo que mueve stock. Nunca se borra ni se edita.
create table movimientos (
  id          bigint generated always as identity primary key,
  creado_en   timestamptz not null default now(),
  sku         text not null references productos(sku),
  cantidad    integer not null check (cantidad > 0),
  desde       text references sucursales(id),   -- null = viene de afuera (carga)
  hasta       text references sucursales(id),   -- null = sale del sistema (venta)
  tipo        tipo_movimiento not null,
  usuario_id  bigint references usuarios(id),
  motivo      text,                               -- obligatorio para ajustes (lo exige la app)
  venta_id    bigint
);
create index movimientos_sku_idx on movimientos (sku, creado_en);

-- Medios de pago: ajuste porcentual sobre el precio de lista (transferencia 0, efectivo -20, tarjeta +20)
create table medios_pago (
  id          text primary key,
  nombre      text not null,
  ajuste_pct  numeric(5,2) not null default 0,
  activo      boolean not null default true
);

create table ventas (
  id                bigint generated always as identity primary key,
  sucursal_id       text not null references sucursales(id),
  usuario_id        bigint references usuarios(id),
  creado_en         timestamptz not null default now(),
  subtotal_lista    integer not null,
  descuento_promo   integer not null default 0,
  medio_pago_id     text references medios_pago(id),
  ajuste_medio_pago integer not null default 0,    -- se guarda el monto, asi cambiar % despues no altera tickets viejos
  ajuste_pct_usado  numeric(5,2),
  total             integer not null,
  -- Reservado para facturacion ARCA a futuro (hoy queda vacio)
  cuit_cliente      text,
  condicion_iva     text
);
create index ventas_fecha_idx on ventas (creado_en);

alter table movimientos add constraint movimientos_venta_fk foreign key (venta_id) references ventas(id);

create table venta_items (
  id            bigint generated always as identity primary key,
  venta_id      bigint not null references ventas(id),
  sku           text not null references productos(sku),
  nombre        text not null,       -- copia del nombre al momento de la venta
  precio_lista  integer not null,    -- copia del precio al momento de la venta
  cantidad      integer not null check (cantidad > 0)
);
create index venta_items_venta_idx on venta_items (venta_id);

-- Datos iniciales
insert into sucursales (id, nombre, es_deposito) values
  ('deposito', 'Depósito', true),
  ('zelarrayan', 'Zelarrayan', false),
  ('white', 'White', false),
  ('sanlorenzo', 'San Lorenzo', false);

insert into tipos (codigo, nombre, alias) values
  ('JEA', 'Jean',     '{jean,jeans}'),
  ('REM', 'Remera',   '{remera,remeras}'),
  ('BUZ', 'Buzo',     '{buzo,buzos,hoodie,canguro}'),
  ('CAM', 'Campera',  '{campera,camperas}'),
  ('PAN', 'Pantalón', '{pantalon,pantalones}'),
  ('SHO', 'Short',    '{short,shorts,bermuda,bermudas}'),
  ('OTR', 'Otro',     '{}');

insert into contadores_sku (tipo) select codigo from tipos;

insert into medios_pago (id, nombre, ajuste_pct) values
  ('transferencia', 'Transferencia', 0),
  ('efectivo', 'Efectivo', -20),
  ('tarjeta', 'Tarjeta', 20);

commit;

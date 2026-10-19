-- Notas de credito internas (devoluciones y cambios).
-- Se emiten contra una venta: el cliente devuelve prendas y recibe una nota que vale lo que pago por ellas
-- (con el recargo o descuento del medio con que pago) y vence a los 15 dias. Se usa como un medio de pago en otra venta.
-- ajuste_pct guarda el ajuste con el que se pago la venta original: la nota cubre valor_de_lista = monto / (1 + ajuste_pct/100).

create table if not exists notas_credito (
  id            bigint generated always as identity primary key,
  codigo        text generated always as ('N' || lpad(id::text, 6, '0')) stored unique,
  venta_id      bigint not null references ventas(id),
  sucursal_id   text not null references sucursales(id),   -- local donde se hizo la devolucion (vuelve ahi el stock)
  creado_en     timestamptz not null default now(),
  vence_en      timestamptz not null,
  monto_inicial integer not null check (monto_inicial > 0),
  saldo         integer not null check (saldo >= 0),
  ajuste_pct    numeric(8,4) not null,
  usuario_id    bigint references usuarios(id)
);
create index if not exists notas_credito_venta_idx on notas_credito (venta_id);

create table if not exists nota_credito_items (
  id             bigint generated always as identity primary key,
  nota_id        bigint not null references notas_credito(id),
  venta_item_id  bigint not null references venta_items(id),
  sku            text not null references productos(sku),
  cantidad       integer not null check (cantidad > 0),
  monto          integer not null check (monto >= 0)
);
create index if not exists nota_credito_items_nota_idx on nota_credito_items (nota_id);
create index if not exists nota_credito_items_vi_idx on nota_credito_items (venta_item_id);

-- Un pago de una venta puede ser una nota de credito.
alter table venta_pagos add column if not exists nota_credito_id bigint references notas_credito(id);
insert into medios_pago (id, nombre, ajuste_pct, activo) values ('nota_credito', 'Nota de crédito', 0, false) on conflict (id) do nothing;

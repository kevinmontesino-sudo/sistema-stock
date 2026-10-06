-- Traslados entre sucursales con aviso y recepcion.
-- Al enviar, el stock sale del origen y el traslado queda "en camino". El destino lo ve como pendiente
-- y lo va recibiendo (escaneando o con "Recibir todo"); recien ahi el stock suma en el destino.

create table if not exists traslados (
  id                bigint generated always as identity primary key,
  creado_en         timestamptz not null default now(),
  sku               text not null references productos(sku),
  cantidad          integer not null check (cantidad > 0),
  cantidad_recibida integer not null default 0 check (cantidad_recibida >= 0),
  desde             text not null references sucursales(id),
  hasta             text not null references sucursales(id),
  estado            text not null default 'en_camino' check (estado in ('en_camino', 'recibido', 'devuelto')),
  recibido_en       timestamptz,
  usuario_id        bigint references usuarios(id),
  check (desde <> hasta),
  check (cantidad_recibida <= cantidad)
);
create index if not exists traslados_destino_idx on traslados (hasta, estado);
create index if not exists traslados_sku_idx on traslados (sku, estado);

-- Nuevo tipo de movimiento: entrada al destino cuando se recibe un traslado.
-- (Va aparte de la transaccion: un valor nuevo de enum no se puede usar dentro de la misma.)
alter type tipo_movimiento add value if not exists 'recepcion';

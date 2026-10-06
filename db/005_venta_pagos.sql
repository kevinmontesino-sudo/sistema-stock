-- Pagos de una venta: permite cobrar con mas de un medio (ej. parte transferencia y parte efectivo).
-- Cada fila es lo que el cliente entrega en un medio (monto) y la parte del valor de lista que cubre.
-- ventas.total es la suma de los montos; ventas.medio_pago_id queda solo si se pago con un unico medio.

create table if not exists venta_pagos (
  id               bigint generated always as identity primary key,
  venta_id         bigint not null references ventas(id),
  medio_pago_id    text not null references medios_pago(id),
  monto            integer not null check (monto >= 0),
  valor_lista      integer not null check (valor_lista >= 0),
  ajuste_pct_usado numeric(5,2) not null
);
create index if not exists venta_pagos_venta_idx on venta_pagos (venta_id);
create index if not exists venta_pagos_medio_idx on venta_pagos (medio_pago_id);

-- Ventas anteriores con un solo medio: se les crea su pago.
insert into venta_pagos (venta_id, medio_pago_id, monto, valor_lista, ajuste_pct_usado)
select v.id, v.medio_pago_id, v.total, v.subtotal_lista, coalesce(v.ajuste_pct_usado, 0)
from ventas v
where v.medio_pago_id is not null and not exists (select 1 from venta_pagos p where p.venta_id = v.id);

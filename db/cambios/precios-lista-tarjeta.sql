-- CAMBIO DE ESTRUCTURA DE PRECIOS: la lista pasa a ser el precio de TARJETA (antes era el de transferencia).
--
-- NO es una migracion numerada (no se aplica sola al refrescar la copia): es un cambio de datos, se corre a mano y se puede revertir.
-- Hoy:    precio_lista = transferencia (0%), efectivo -20%, tarjeta +20%.
-- Nuevo:  precio_lista = tarjeta (0%) = lista vieja x factor (1,20), redondeada; transferencia -10%, efectivo -30% (todo parametrizable).
--
-- Que hace (todo en UNA transaccion; por defecto termina en ROLLBACK = ensayo):
--   1) productos.precio_lista = redondear(lista x factor)  (indice productos_unico_activo: se suelta y se recrea dentro de la transaccion)
--   2) medios_pago.ajuste_pct = los porcentajes nuevos (y se ensancha la columna a numeric(8,4) si algun porcentaje trae decimales)
--   3) notas de credito vigentes (saldo > 0): ajuste_pct' = ((1 + ajuste_pct/100) / factor - 1) x 100  (la nota sigue cubriendo la MISMA prenda)
--   4) promos tipo 'precio' vigentes con descuento_efectivo = true: precio x factor, redondeado igual (las demas no cambian)
--   5) respaldos reversibles: respaldo_precios_AAAAMM, respaldo_notas_AAAAMM, respaldo_promos_AAAAMM (+ fila en cambios_lista)
--   6) una fila en auditoria ('cambio_estructura_precios') y la fila de cambios_lista, que guarda la FECHA DE CORTE: las devoluciones
--      de ventas anteriores al corte generan notas con el porcentaje convertido (ver lib/repo.ts, corteDeLista).
--
-- NO se corre directo: usar app/scripts/staging-precios.sh (npm run staging:precios), que solo apunta a la copia de pruebas.
-- Variables de psql (-v nombre=valor), todas con valor por defecto:
--   modo=ensayo|aplicar|revertir   (ensayo: ROLLBACK)      pct_tarjeta=0   pct_transferencia=-10   pct_efectivo=-30
--   redondeo=exacto|centena|fin900 (defecto fin900)         factor=1.2      forzar=0|1 (revertir aunque haya ventas posteriores)
--   sufijo=AAAAMM (defecto: mes actual)

\set ON_ERROR_STOP on
\set QUIET on
\pset footer off
\pset null '-'
\if :{?modo} \else \set modo ensayo \endif
\if :{?redondeo} \else \set redondeo fin900 \endif
\if :{?pct_tarjeta} \else \set pct_tarjeta 0 \endif
\if :{?pct_transferencia} \else \set pct_transferencia -10 \endif
\if :{?pct_efectivo} \else \set pct_efectivo -30 \endif
\if :{?factor} \else \set factor 1.2 \endif
\if :{?forzar} \else \set forzar 0 \endif
\if :{?sufijo} \else
  select to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYYMM') as sufijo \gset
\endif

begin;
set local app.mantenimiento = 'on';
set local lock_timeout = '15s';

create temp table prm as select
  :'modo'::text as modo, :'redondeo'::text as redondeo, :'sufijo'::text as sufijo,
  (:'pct_tarjeta')::numeric as tarjeta, (:'pct_transferencia')::numeric as transferencia, (:'pct_efectivo')::numeric as efectivo,
  (:'factor')::numeric as factor, (:'forzar')::int as forzar;

do $$
declare p prm%rowtype;
begin
  select * into p from prm;
  if p.modo not in ('ensayo', 'aplicar', 'revertir') then raise exception 'modo invalido: %', p.modo; end if;
  if p.redondeo not in ('exacto', 'centena', 'fin900') then raise exception 'redondeo invalido: % (exacto, centena o fin900)', p.redondeo; end if;
  if p.sufijo !~ '^[0-9]{6}$' then raise exception 'sufijo invalido: % (AAAAMM)', p.sufijo; end if;
  if p.factor <= 0.5 or p.factor > 3 then raise exception 'factor fuera de rango: %', p.factor; end if;
  if p.tarjeta < -60 or p.tarjeta > 60 or p.transferencia < -60 or p.transferencia > 60 or p.efectivo < -60 or p.efectivo > 60 then
    raise exception 'porcentaje de medio de pago fuera de rango (-60 a 60)';
  end if;
end $$;

create function pg_temp.redondear(x numeric, modo text) returns integer language sql immutable as $f$
  select case modo
    when 'exacto' then round(x)::int
    when 'centena' then (ceil(x / 100) * 100)::int
    else (ceil((x + 100) / 1000) * 1000 - 100)::int   -- fin900: hacia arriba, terminacion 900
  end
$f$;

create table if not exists cambios_lista (
  id bigint generated always as identity primary key,
  aplicado_en timestamptz not null default clock_timestamp(),
  factor numeric(8,4) not null,
  params jsonb not null default '{}'::jsonb,
  medios_antes jsonb not null default '{}'::jsonb,
  sufijo text not null,
  revertido_en timestamptz
);
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'stock_web') then grant select on cambios_lista to stock_web; end if;
end $$;


select (modo = 'revertir') as es_revertir from prm \gset

\if :es_revertir
-- =====================================================================  REVERTIR
select (count(*) > 0) as hay_cambio from cambios_lista where revertido_en is null \gset
\if :hay_cambio \else
  do $$ begin raise exception 'No hay ningun cambio de estructura de precios para revertir (cambios_lista vacia o ya revertido).'; end $$;
\endif
select id as cambio_id, sufijo as suf_orig, aplicado_en from cambios_lista where revertido_en is null order by id desc limit 1 \gset
select count(*) as ventas_despues from ventas where creado_en > :'aplicado_en' \gset
\echo '== REVERTIR el cambio de estructura de precios aplicado el ' :aplicado_en ' (respaldos _' :suf_orig ')'
\echo 'Ventas hechas desde entonces: ' :ventas_despues
select (:ventas_despues > 0 and (select forzar from prm) = 0) as bloquea \gset
\if :bloquea
  do $$ begin raise exception 'Hubo ventas despues del cambio: revertir dejaria precios y notas mezclados. Si igual queres revertir (ej. copia de pruebas), repetir con --forzar.'; end $$;
\endif

select format('create temp table r_precios as select * from %I', 'respaldo_precios_' || :'suf_orig') \gexec
select format('create temp table r_notas as select * from %I', 'respaldo_notas_' || :'suf_orig') \gexec
select format('create temp table r_promos as select * from %I', 'respaldo_promos_' || :'suf_orig') \gexec

drop index if exists productos_unico_activo;
update productos p set precio_lista = r.precio_lista from r_precios r where r.sku = p.sku and p.precio_lista <> r.precio_lista;
create unique index productos_unico_activo on productos (tipo, nombre_norm, precio_lista) where activo;
update medios_pago m set ajuste_pct = (c.medios_antes ->> m.id)::numeric
  from cambios_lista c where c.id = :cambio_id and c.medios_antes ? m.id;
update notas_credito n set ajuste_pct = r.ajuste_pct from r_notas r where r.id = n.id;
update promos p set precio = r.precio from r_promos r where r.id = p.id;
update cambios_lista set revertido_en = now() where id = :cambio_id;
insert into auditoria (usuario_email, accion, detalle)
  values ('script:precios-lista-tarjeta', 'cambio_estructura_precios_revertido', jsonb_build_object('cambio_id', :cambio_id, 'sufijo', :'suf_orig', 'ventas_despues', :ventas_despues));
-- Los respaldos se conservan con otro nombre (para poder aplicar de nuevo el mismo mes).
select format('alter table %I rename to %I', t || :'suf_orig', t || :'suf_orig' || '_rev' || to_char(now(), 'DDHH24MISS'))
  from unnest(array['respaldo_precios_', 'respaldo_notas_', 'respaldo_promos_']) t \gexec

\echo '== Resultado (revertido):'
select (select count(*) from r_precios) as productos_restaurados, (select count(*) from r_notas) as notas_restauradas, (select count(*) from r_promos) as promos_restauradas;
select id, ajuste_pct as "ajuste_pct ahora" from medios_pago order by id;

\else
-- =====================================================================  ENSAYO / APLICAR
select (count(*) > 0) as ya_aplicado from cambios_lista where revertido_en is null \gset
\if :ya_aplicado
  do $$ begin raise exception 'La estructura nueva ya esta aplicada (cambios_lista). Para volver atras: --revertir.'; end $$;
\endif
-- Si quedo un respaldo del mismo mes sin revertir, no se pisa.
select (to_regclass('respaldo_precios_' || :'sufijo') is not null) as respaldo_existe \gset
\if :respaldo_existe
  do $$ begin raise exception 'Ya existe respaldo_precios_% : usar otro sufijo (-v sufijo=AAAAMM) o renombrar esa tabla.', (select sufijo from prm); end $$;
\endif

create temp table medios_viejo as select id, ajuste_pct from medios_pago;
create temp table viejo as select sku, tipo, nombre, nombre_norm, activo, precio_lista from productos;
create temp table nuevo as
  select v.sku, v.tipo, v.nombre_norm, v.activo, v.precio_lista as lista_vieja, pg_temp.redondear(v.precio_lista * prm.factor, prm.redondeo) as lista_nueva
  from viejo v, prm;
create temp table notas_viejo as select id, codigo, saldo, ajuste_pct from notas_credito where saldo > 0;
create temp table promos_viejo as
  select id, nombre, precio from promos
  where tipo = 'precio' and descuento_efectivo and activa and hasta >= (now() at time zone 'America/Argentina/Buenos_Aires')::date;

\echo
\echo '== Parametros'
select modo, redondeo, 'lista x ' || factor as lista_nueva, tarjeta as "tarjeta %", transferencia as "transferencia %", efectivo as "efectivo %" from prm;

-- Choques del indice unico (tipo, nombre, precio) entre prendas activas con la lista nueva.
create temp table choques as
  select tipo, nombre_norm, lista_nueva, count(*) as prendas, string_agg(sku, ', ' order by sku) as skus
  from nuevo where activo group by tipo, nombre_norm, lista_nueva having count(*) > 1;
select (count(*) > 0) as hay_choques, count(*) as n_choques from choques \gset
\if :hay_choques
  \echo '!! CHOQUES con el indice productos_unico_activo (dos prendas quedarian iguales: mismo tipo, nombre y precio):'
  select * from choques;
\endif

-- Columnas de porcentaje: se ensanchan solo si algun valor nuevo trae mas de 2 decimales.
select (
  exists (select 1 from prm where tarjeta <> round(tarjeta, 2) or transferencia <> round(transferencia, 2) or efectivo <> round(efectivo, 2))
  or exists (select 1 from notas_viejo, prm where round(((1 + ajuste_pct / 100) / factor - 1) * 100, 4) <> round(((1 + ajuste_pct / 100) / factor - 1) * 100, 2))
) as ensanchar \gset
\if :ensanchar
  \echo '-> Se ensanchan medios_pago.ajuste_pct, venta_pagos.ajuste_pct_usado y ventas.ajuste_pct_usado a numeric(8,4).'
  alter table medios_pago alter column ajuste_pct type numeric(8,4);
  alter table venta_pagos alter column ajuste_pct_usado type numeric(8,4);
  alter table ventas alter column ajuste_pct_usado type numeric(8,4);
\endif

-- Respaldos (en la misma transaccion: si se hace ROLLBACK no queda nada).
select format('create table %I as select * from viejo', 'respaldo_precios_' || :'sufijo') \gexec
select format('create table %I as select * from notas_viejo', 'respaldo_notas_' || :'sufijo') \gexec
select format('create table %I as select * from promos_viejo', 'respaldo_promos_' || :'sufijo') \gexec
-- 1) Precios de lista.
drop index if exists productos_unico_activo;
update productos p set precio_lista = n.lista_nueva from nuevo n where n.sku = p.sku;
\if :hay_choques
  \echo '(el indice unico no se puede recrear con estos choques: en modo aplicar el cambio se frena)'
\else
  create unique index productos_unico_activo on productos (tipo, nombre_norm, precio_lista) where activo;
\endif
-- 2) Medios de pago.
update medios_pago m set ajuste_pct = case m.id when 'tarjeta' then prm.tarjeta when 'transferencia' then prm.transferencia when 'efectivo' then prm.efectivo end
  from prm where m.id in ('tarjeta', 'transferencia', 'efectivo');
-- 3) Notas de credito vigentes (el trigger proteger_notas_credito deja pasar con app.mantenimiento = 'on').
update notas_credito n set ajuste_pct = round(((1 + v.ajuste_pct / 100) / prm.factor - 1) * 100, 4)
  from notas_viejo v, prm where v.id = n.id;
-- 4) Promos de precio con descuento de efectivo.
update promos p set precio = pg_temp.redondear(v.precio * prm.factor, prm.redondeo) from promos_viejo v, prm where v.id = p.id;
-- 5) Registro del cambio + auditoria.
insert into cambios_lista (factor, params, medios_antes, sufijo)
  select factor, jsonb_build_object('redondeo', redondeo, 'tarjeta', tarjeta, 'transferencia', transferencia, 'efectivo', efectivo, 'factor', factor),
         (select jsonb_object_agg(id, ajuste_pct) from medios_viejo), sufijo
  from prm;
insert into auditoria (usuario_email, accion, detalle)
  select 'script:precios-lista-tarjeta', 'cambio_estructura_precios',
         jsonb_build_object('redondeo', redondeo, 'tarjeta', tarjeta, 'transferencia', transferencia, 'efectivo', efectivo, 'factor', factor,
           'productos', (select count(*) from nuevo), 'notas', (select count(*) from notas_viejo), 'promos', (select count(*) from promos_viejo),
           'sufijo', sufijo, 'ensanchado', :'ensanchar'::boolean)
  from prm;

\echo
\echo '== Medios de pago (antes -> despues)'
select m.id as medio, v.ajuste_pct as antes, m.ajuste_pct as despues from medios_pago m join medios_viejo v using (id) order by m.id;
\echo
\echo '== Prendas activas: lista y precios por medio (hoy -> nuevo)'
select p.sku, left(p.nombre, 24) as prenda,
       n.lista_vieja as "lista hoy", p.precio_lista as "lista nueva",
       round(n.lista_vieja * (1 + (select ajuste_pct from medios_viejo where id = 'efectivo') / 100)) as "efvo hoy",
       round(p.precio_lista * (1 + prm.efectivo / 100)) as "efvo nuevo",
       round(n.lista_vieja * (1 + (select ajuste_pct from medios_viejo where id = 'transferencia') / 100)) as "transf hoy",
       round(p.precio_lista * (1 + prm.transferencia / 100)) as "transf nuevo",
       round(n.lista_vieja * (1 + (select ajuste_pct from medios_viejo where id = 'tarjeta') / 100)) as "tarj hoy",
       round(p.precio_lista * (1 + prm.tarjeta / 100)) as "tarj nuevo"
  from productos p join nuevo n using (sku) cross join prm where p.activo order by p.sku;
\echo
\echo '== Notas de credito vigentes (porcentaje antes -> despues; la nota cubre la misma prenda)'
select n.codigo, n.saldo, v.ajuste_pct as "pct antes", n.ajuste_pct as "pct despues" from notas_credito n join notas_viejo v using (id) order by n.codigo;
\echo
\echo '== Promos de precio con descuento de efectivo (precio antes -> despues)'
select p.id, p.nombre, v.precio as antes, p.precio as despues from promos p join promos_viejo v using (id) order by p.id;
\echo
select (select count(*) from nuevo) as productos, (select count(*) from notas_viejo) as notas_vigentes, (select count(*) from promos_viejo) as promos_ajustadas, :n_choques as choques;

\if :hay_choques
  select (modo = 'aplicar') as frenar from prm \gset
  \if :frenar
    do $$ begin raise exception 'Hay choques de precios (ver arriba): no se aplica nada. Cambiar el redondeo o renombrar/unificar esas prendas.'; end $$;
  \endif
\endif
\endif

select (modo in ('aplicar', 'revertir')) as confirmar from prm \gset
\if :confirmar
  commit;
  \echo '>> COMMIT: cambio guardado.'
\else
  rollback;
  \echo '>> ENSAYO: ROLLBACK, no se guardo nada. Para aplicar: npm run staging:precios -- --aplicar'
\endif

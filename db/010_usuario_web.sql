-- USUARIO DE LA BASE CON PERMISOS MINIMOS PARA LA APLICACION (correr con un superusuario de Postgres, por ejemplo desde DBGate
-- conectado como administrador; stock_app no tiene permiso para crear roles).
--
-- Por que: hoy la aplicacion se conecta como stock_app, que es DUENO de las tablas y por eso podria, si alguien la
-- vulnerara, desactivar las protecciones o borrar historial. Con stock_web la app solo puede lo que necesita.
--
-- Pasos:
--   1) Reemplazar CLAVE_LARGA_AL_AZAR por una clave generada (32+ caracteres) y correr este archivo.
--   2) En Easypanel, en la app, poner DATABASE_URL con el usuario stock_web (host interno de la base, no el externo).
--   3) stock_app queda solo para migraciones y scripts de mantenimiento (npm run respaldo, usuario, etc.).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'stock_web') then
    create role stock_web login password 'CLAVE_LARGA_AL_AZAR' nosuperuser nocreatedb nocreaterole noinherit;
  end if;
end;
$$;

grant connect on database sistema_stock to stock_web;
grant usage on schema public to stock_web;
revoke all on all tables in schema public from stock_web;

-- Solo lectura
grant select on sucursales, medios_pago to stock_web;
-- Lectura y alta (historial contable: nunca se modifica ni se borra)
grant select, insert on ventas, venta_items, venta_pagos, nota_credito_items, movimientos, cargas, auditoria, intentos_login to stock_web;
-- Lectura, alta y cambio (sin borrar)
grant select, insert, update on productos, stock, traslados, contadores_sku, tipos, notas_credito, usuarios to stock_web;
-- Sesiones: se crean, se actualizan y se borran al cerrar o vencer
grant select, insert, update, delete on sesiones to stock_web;

grant usage, select on all sequences in schema public to stock_web;

-- Para tablas nuevas en el futuro, dar permisos explicitos (no se hereda nada por defecto).

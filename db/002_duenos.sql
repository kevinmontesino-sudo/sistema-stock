-- Pasa a stock_app la propiedad de todo lo creado por 001_schema.sql.
-- Ejecutar en DBGate conectado como postgres, sobre la base sistema_stock.
-- Las secuencias de las columnas identity cambian de dueno junto con su tabla.

alter table sucursales     owner to stock_app;
alter table tipos          owner to stock_app;
alter table usuarios       owner to stock_app;
alter table productos      owner to stock_app;
alter table contadores_sku owner to stock_app;
alter table stock          owner to stock_app;
alter table cargas         owner to stock_app;
alter table movimientos    owner to stock_app;
alter table medios_pago    owner to stock_app;
alter table ventas         owner to stock_app;
alter table venta_items    owner to stock_app;

alter type rol_usuario     owner to stock_app;
alter type tipo_movimiento owner to stock_app;

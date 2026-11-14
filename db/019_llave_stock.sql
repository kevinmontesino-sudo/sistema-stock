-- Llave de la API de SOLO STOCK (para el asistente que contesta consultas de clientes, por ejemplo desde n8n).
-- Alcance "stock": solo puede abrir /api/stock (prendas, precios y cantidad por local). No entra a informes, promos ni a nada de ventas.
-- Aplicar ANTES de desplegar el codigo que la usa. Es seguro correrla mas de una vez.
alter table tokens_api drop constraint if exists tokens_api_alcance_check;
alter table tokens_api add constraint tokens_api_alcance_check check (alcance in ('informes', 'promos', 'stock'));

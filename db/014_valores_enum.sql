-- Valores de enum que la produccion ya tiene pero que no estaban en ninguna migracion (se agregaron a mano):
-- sin esto, una base nueva armada con los archivos de db/ no puede crear encargados ni registrar devoluciones.
-- Es seguro correrlo en produccion: "if not exists" no hace nada si el valor ya esta.
-- Se corre aparte (un valor nuevo de enum no se puede usar dentro de la misma transaccion en que se agrega).
alter type rol_usuario add value if not exists 'encargado';
alter type tipo_movimiento add value if not exists 'devolucion';

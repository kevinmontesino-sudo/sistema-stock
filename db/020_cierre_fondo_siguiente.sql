-- Cierre de caja: cuanto se deja en la caja para el vuelto del dia siguiente (el resto va a la caja fuerte de la empresa).
-- Es nulo en los cierres viejos (anteriores a este cambio). Es una columna nueva: no toca la proteccion de los cierres.
alter table cierres_caja add column if not exists fondo_siguiente integer check (fondo_siguiente is null or fondo_siguiente >= 0);

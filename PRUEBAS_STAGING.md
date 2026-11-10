# Copia de pruebas (staging)

## Qué es

Es **una copia del sistema real en tu Mac**: los mismos datos (prendas, stock, ventas, usuarios) y el mismo código
compilado igual que en producción. Lo que hagas ahí **no toca la base real**: es una base aparte
(`sistema_stock_staging`) armada con el último respaldo diario (el de las 22:30, en `~/respaldos-stock-completos`).

Arriba de cada pantalla aparece un cartel rojo: **COPIA DE PRUEBAS — no es el sistema real**. Si no ves el cartel, no estás en la copia.

## Cuándo usarla

Antes de cualquier cambio grande o "bruto", por ejemplo:

- cambiar todos los precios, o los porcentajes de los medios de pago;
- una migración nueva de la base (`db/016_...sql`);
- un cambio de código que toca la caja, las promos, las devoluciones o los informes.

Para cosas chicas de pantalla alcanza con `npm run dev` (datos inventados).

## Los 3 comandos (desde la carpeta `app`)

| Comando | Qué hace |
|---|---|
| `npm run staging:refrescar` | Borra la copia y la vuelve a armar con el **último respaldo**, y le aplica las migraciones de `db/`. Muestra un resumen (prendas, ventas, usuarios, fecha del respaldo). Para usar otro respaldo: `npm run staging:refrescar -- ~/respaldos-stock-completos/stock-2026-11-06_2230.dump` |
| `npm run staging` | Compila en modo producción y abre el sistema de pruebas en **http://localhost:3000** (Ctrl+C para pararlo). Con `npm run staging -- --sin-compilar` arranca el último build sin volver a compilar. |
| `npm run staging:probar` | Corre **100 pruebas automáticas** de punta a punta sobre la copia: carga prendas "ZZ Prueba", envío a White y recepción, ventas en efectivo / transferencia / tarjeta / mixto, promo 3x2, promo de precio, descuento especial, devolución (también con prenda fallada), pago con nota de crédito (entera y parte), cobro repetido, reimpresión de tickets, informes y controles de toda la base (pagos = total, stock nunca negativo, etc.). Al final: tabla OK / MAL. Si algo da MAL, **no subir el cambio**. |

## Flujo recomendado para un cambio grande

1. `npm run staging:refrescar` → copia fresca, igual a la real de anoche.
2. **Aplicar el cambio en la copia**: si es una migración, ponerla en `db/` (el refrescar la aplica sola) o correrla a mano contra `sistema_stock_staging`; si es código, solo guardarlo.
3. `npm run staging:probar` → todo tiene que dar OK.
4. `npm run staging` → mirarlo en el navegador (Chrome): vender, imprimir un ticket, revisar informes.
5. Recién ahí, **producción** (subir el código / correr la migración en la base real, como siempre).
6. `npm run staging:refrescar` → deja la copia limpia otra vez (las pruebas dejan prendas y ventas "ZZ").

## Cosas a tener en cuenta

- **No correr `npm run staging` y `npm run dev` al mismo tiempo**: los dos usan el puerto 3000 (el agente de impresión solo acepta ese puerto). Si el 3000 está ocupado, el comando avisa y no arranca. Para otro puerto: `PUERTO=3100 npm run staging` (pero ahí no imprime).
- **Imprime de verdad**: las etiquetas y tickets salen por las impresoras de esta Mac.
- **Logins**: son los mismos usuarios y contraseñas que en el sistema real. Para que los administradores puedan entrar con su código de doble verificación, `npm run staging` toma en el momento la línea `APP_KEY` de `app/.env.prod.local` (sin mostrarla y sin leer nada más de ese archivo). Si ese archivo no está, los usuarios de los locales entran igual, pero los admin con doble verificación no.
- **Navegador**: usar Chrome o Edge. En modo producción la sesión usa una cookie segura que Safari puede no guardar en `http://localhost`.
- **Los datos son los del último respaldo**, no los de este minuto: lo que se vendió hoy en los locales no está hasta el respaldo de la noche.
- El build de pruebas se guarda en `app/.next/staging`: no pisa el de `npm run dev`.
- Las migraciones que el refrescar **no** repite (porque arman la base desde cero o borran columnas): 001, 002, 003, 010 y 011. Toda migración nueva tiene que poder correrse dos veces (`if not exists`, etc.); si falla en la copia, el refrescar lo dice y se corta: arreglarla antes de llevarla a producción.
- Ninguno de estos comandos se conecta a la base real: si la configuración apuntara a otra base, se niegan a correr.

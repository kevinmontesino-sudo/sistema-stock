# Plan de integraciones: Ficha y Tiendanube (borrador, 25/11/2026)

Documento de arranque para chats nuevos. Un chat por proyecto, y este archivo es la fuente de verdad. Las llaves y claves NUNCA van en el chat ni en el código: solo en Easypanel (variables de entorno del servidor).

## Estado de hoy (ya funciona)
- **Stock -> Ficha:** compra de empleado baja stock y carga a la cuenta corriente (`POST /api/compras-empleado` con `STOCK_API_KEY`, idempotente por referencia). Primera compra real enviada el 24/11 (Mayra Rosales, $9.600). Falta confirmar que se ve en Administración > Compras de la ficha.
- **Stock <- Ficha:** lista de empleados activos (`GET /api/empleados-activos`) y vendedores en la caja.
- **Stock -> n8n:** `GET /api/stock` con llave aislada "stock".
- **Stock -> Claude de César:** `/api/informes` y `/api/promos` con llaves propias.

## Proyecto A: Ficha (rápido, riesgo bajo)
Orden sugerido, de a uno, cada uno con su prueba:
1. Confirmar la compra de empleado en pantalla de la ficha (ya enviada).
2. **Rankings diarios automáticos:** el stock manda a la ficha las ventas del día por sucursal (total, efectivo, tickets > $50.000, ticket promedio). Hoy se cargan a mano en `/api/rankings`. Pide una llave NUEVA y acotada en la ficha (ej. `RANKINGS_API_KEY`), solo para esa ruta.
3. **Gastos de sucursal:** evaluar si los retiros/gastos de caja se linkean con `/api/gastos`. Llave propia (ej. `GASTOS_API_KEY`).
4. Comisiones por vendedor desde las ventas (el stock ya guarda quién vendió).
Regla: NO usar la llave global de automatización de la ficha (abre sueldos y personal). Una llave por función, con el mínimo permiso. La ficha es de Antigravity: los cambios en la ficha los hace él; el stock solo consume.

## Proyecto B: Tiendanube (grande, hay una decisión previa)
**El obstáculo:** Tiendanube maneja el stock por VARIANTE (talle/color). Nuestro sistema tiene un SKU por producto y NO tiene talle. Hay que decidir antes de programar:
- Opción 1: cada talle pasa a ser un SKU propio (etiquetas y catálogo por talle). Es lo más limpio pero obliga a rehacer el catálogo.
- Opción 2: en Tiendanube cada producto va con una sola variante y el stock total del producto. Rápido, pero no se puede vender por talle online.
- Opción 3: dejar talles solo en Tiendanube y descontar del stock total (se pierde precisión).

**Orden sugerido**
1. Terminar el etiquetado y la limpieza del catálogo (hay productos repetidos con errores de tipeo y precio). Sin catálogo limpio no se puede publicar.
2. Decidir la opción de talles (Kevin).
3. Crear la app en Tiendanube (credenciales OAuth del lado de Kevin) y probar con 1 producto en una tienda de prueba.
4. Sentido 1: stock -> Tiendanube (cuando se vende/ingresa en un local, se actualiza la tienda).
5. Sentido 2: pedido en Tiendanube -> descuento de stock (webhook de orden pagada). Definir de qué local sale el stock online (probablemente Depósito).
6. Precios: la tienda usa lista=transferencia (estructura de siempre); definir cómo se muestran efectivo/tarjeta online.
7. Prueba en la copia de pruebas (staging) y recién después producción, con migración antes del deploy.

## Cómo trabajar sin perder el hilo
- Un chat por proyecto (A y B). Primer mensaje: "leé PLAN_INTEGRACIONES.md y PLAN_OPERATIVO.md".
- Cada paso: probar en staging (`npm run staging:probar`), migración en la base real ANTES de desplegar, commit chico, push de Kevin, Implementar.
- Al cerrar cada paso se actualiza este archivo (qué quedó hecho / qué falta).

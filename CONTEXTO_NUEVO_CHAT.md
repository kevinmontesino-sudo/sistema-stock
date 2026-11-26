# Contexto completo para arrancar un chat nuevo (25/11/2026)

Pegá en el primer mensaje del chat nuevo: **"Leé CONTEXTO_NUEVO_CHAT.md, PLAN_OPERATIVO.md y PLAN_INTEGRACIONES.md y seguimos"**. Este archivo resume todo lo que hace falta; el plan detallado y las decisiones viejas están en `PLAN_OPERATIVO.md`.

---

## 1. Quién es Kevin y cómo trabajar con él
- Kevin Montesino es el dueño operativo de **X Menos Más Prendas** (ropa; locales Zelarrayan, White, San Lorenzo + Depósito). No es programador: quiere cosas claras, cortas y que funcionen. Habla en español rioplatense informal.
- **Responder en español, corto, sin tecnicismos.** Decir qué hacer paso a paso. Cuando pregunta "confirmame", contestar primero sí/no y después el detalle. Ser honesto: si algo no se pudo probar o no se puede ver (por ejemplo pantallas con sesión iniciada), decirlo.
- **No pedirle que ejecute scripts SQL.** Las migraciones las aplico yo directo (ver 3). Tampoco pegarle comandos largos.
- Mira capturas de pantalla desde el navegador y las manda; mirarlas con cuidado, muchas veces el problema es que **no tocó el medio de pago** o que está viendo otra versión (pedirle Cmd+Shift+R después de Implementar).
- Se confunde con interfaces con demasiados botones: preferir pocos botones visibles y cosas a mano (cortesía, regalo, cobros), el resto en desplegables.
- Hace las pruebas reales en los locales con empleados; los errores le salen caros (hubo un incidente de ventas sin registrar, ver 3).
- Usa **Antigravity** en paralelo (otra IA) para informes, publicación, impresión local y el sistema de ficha. Zonas: Claude = núcleo del stock, seguridad, promos, cierre diario, base. No pisar la ficha: es de Antigravity.

## 2. El sistema
- Sistema de stock y caja (POS) publicado en **https://stock-caja-ventas.xmenosmasprendas.com**. Repo GitHub `kevinmontesino-sudo/sistema-stock`, rama `main`.
- Stack: **Next.js 16** (server actions; leer `app/AGENTS.md` y `node_modules/next/dist/docs/` antes de tocar APIs de Next, tiene cambios), React 19, TypeScript, `pg`, Postgres 17. `proxy.ts` tiene la lista de rutas con llave Bearer.
- Hosting: VPS con **Easypanel**. Se publica con el botón **"Implementar"** después de que Kevin hace `git push origin main`.
- Carpeta del proyecto: `/Users/usuario/Documents/sistema stock` (app en `app/`, migraciones en `db/`, agente de impresión en `agente-impresion/`, kit de PC nueva en `kit-pc-nueva/`).
- Hardware: etiquetas Xprinter XP-410B (50x30 o 50x25, se elige por PC), tickets Epson TM-T20IV-L (80 mm), lector Nictom 6200W. El **agente de impresión local** (`agente-impresion/`) va en cada PC con impresora (paso a paso en la memoria `agente-impresion-instalar-pc`).
- Roles: admin (Kevin, César, Guillermo), encargado, vendedor, depósito. Una cuenta por sucursal (sin código); 2FA solo admin. Sesión de local de 30 días.

## 3. Cómo trabajamos (reglas operativas, MUY importantes)
1. **Commits:** yo commiteo cuando Kevin dice "dale / subilo / tirá un commit". Terminar el mensaje con la línea `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. **Nunca pushear: el sistema me lo bloquea; Kevin ejecuta `git push origin main`** (pasarle el comando en un bloque de código). Después él toca Implementar.
2. **Migración ANTES de desplegar (incidente 11-12/11: sin la 018 no se registraron ventas ~18 h).** Si un commit necesita migración, aplicarla en la base real **antes** de que Kevin pushee, y decirlo bien marcado. Se aplica con un script Node que lee `.env.prod.local` (rol `stock_app`) y ejecuta el `.sql`; verificar después leyendo la base. Los `.sql` quedan en `db/NNN_*.sql` y se pueden correr más de una vez. En producción solo existe el rol `stock_app`.
   - Script usado en esta sesión: `mig.cjs` en la carpeta temporal de la sesión (puede no existir ya). Es simple: `pg` + `fs.readFileSync(archivo)` + `pool.query`. Ejemplo: `cd app && NODE_PATH="$PWD/node_modules" node --env-file=.env.prod.local <ruta>/mig.cjs ../db/NNN.sql`. Para staging usar `.env.staging.local`.
3. **Bases:** dev `sistema_stock_dev` (`app/.env.local`, localhost), copia de pruebas `sistema_stock_staging` (`app/.env.staging.local`), real `sistema_stock` (`app/.env.prod.local`, por **túnel SSH** a `127.0.0.1:15432`; si "no conecta", revisar el LaunchAgent `com.xmenosmasprendas.tunel-postgres`, nunca reabrir el puerto 5432).
4. **Pruebas:** `cd app && npm run staging:probar` corre las pruebas de punta a punta en la copia de pruebas (última corrida: **353 OK, 0 MAL**). Usar siempre antes de cambios con plata. Para refrescar la copia: `npm run staging:refrescar`. Los datos de prueba llevan prefijo **ZZ**. Chequeo de tipos: `npx tsc --noEmit -p .` en `app/`.
5. **Datos inmutables:** ventas, ítems, pagos, movimientos, cierres, retiros, conteos y auditoría no se editan ni se borran (triggers). Solo con `set local app.mantenimiento='on'` y solo para limpiar datos ZZ de prueba. Nunca sobre datos reales. Las ventas anuladas no se borran (`ventas_anuladas`; todo SQL que suma ventas usa `NO_ANULADA`).
6. **Claves:** nunca pegar llaves ni contraseñas en el chat ni en el código; van en Easypanel o en archivos `.local`. Ninguna cuenta/clave de Kevin va a servicios externos.
7. **No commitear** (están sin seguimiento a propósito): `driver-nexus*`, `facturacion documentacion /`, `kit-pc-nueva*`, `INSTALAR-MAC.command`, `agente-impresion/dist/*.zip`, los archivos `.local`. Tampoco `LISTA_COMPRAS_HARDWARE.txt` ni `PEDIDO_COTIZACION_IMPRESORA.txt`.
8. **No verifiqué pantallas con sesión iniciada** (el navegador integrado cae al login y no ingreso credenciales): decirle a Kevin que pruebe y mande captura.
9. Antes de afirmar algo sobre el código, verificar en el archivo; las notas de memoria pueden estar viejas.

## 4. Modelo de plata y precios (no cambiar sin hablar)
- **Estructura de siempre (decidido 10/11):** el precio de lista = **transferencia**; **efectivo −20%**; **tarjeta +20%** (tabla `medios_pago`). Se descartó cambiarla.
- Un producto = un SKU por modelo (categoría + nombre + precio). **No existe el talle como dato**: el vendedor es quien sabe el talle. Por eso las promos "a mano".
- "Producto único": importados con precio de efectivo a mano (`productos.precios_medio`).
- Pago mixto y notas de crédito funcionan; las notas no cuentan como medio para las promos.
- Campos de plata: la función `fmtMonto` + `soloDigitos` (en `app/lib/util.ts`) pone los puntos de miles al escribir; todos los campos de plata ya la usan (guardan solo dígitos).

## 5. Promos (lo más tocado en estos días)
- Tabla `promos`; cálculo puro en `app/lib/promos.ts` (la caja y el servidor usan el mismo); el **servidor siempre recalcula** al cobrar (`registrarVenta` en `app/lib/repo.ts`).
- Tipos: **NxM** (3x2: por cada N prendas se regalan N−M, las más baratas), **% off**, **precio fijo** ("Todo a $X", mínimo opcional), con locales, fechas, categorías, medios de pago, "además corren descuentos por medio de pago" (sin tildar = precio único), "sin cambio".
- **Por productos (`skus`)** y **"a mano" (`manual`)**: la promo no se aplica sola; en la caja sale un botón **"Aplicar"** en la fila de la prenda y el vendedor lo toca solo donde corresponde (por talle, etc.).
  - Con productos elegidos: el botón sale solo en esos. **Sin productos: sale en cualquier prenda** (o de las categorías elegidas).
  - % o precio fijo: el renglón queda con el precio ya rebajado (`precio_lista` rebajado; `precio_original`, `promo_manual_id`, `promo_manual_nombre` guardan el original).
  - **NxM a mano:** el vendedor marca las prendas que entran; el descuento se calcula entre las marcadas (`mejorPromoConManuales`); el precio del renglón no cambia, el descuento va en `ventas.descuento_promo`.
  - Una venta solo lleva **una** promo automática/NxM (gana la que más descuenta); las prendas con promo a mano de % o precio no entran en las automáticas; no se suma con descuento especial.
- **Descuento especial** (1–50%, motivo y quién autorizó) y **Curva Plus** (25% mayorista solo en Depósito, suma el −20% de efectivo).
- **Cortesía empresarial** (prendas sin cobrar, comprobante "Cortesía de la casa", solo con stock real) y **"Es regalo"** (dos tickets) son cosas distintas. La cortesía está suelta debajo de "Imprimir el ticket"; "Más opciones" solo tiene el descuento especial y aparece si está disponible.
- **"Vender una prenda que no está cargada"** está pegado debajo del buscador.
- Migraciones: 015 promos, 021 medios, 028 skus/manual, **029** (NxM a mano), **030** (a mano sin productos). Todas aplicadas en la real.
- Una promo con medio "solo efectivo": hasta que no se elige el medio de pago en la caja, se ve el precio de lista (Kevin se confundió con esto; hay que tocar "Efectivo").

## 6. Dinero y control
- **Cierre de caja** (`/cierre`): fondo de apertura, cobrado en efectivo (lo calcula el sistema), pagos/gastos, contado al cerrar, **fondo para mañana** (obligatorio, puede ser 0). Caja fuerte = contado − dejado. Inmutable. Informe diario A4 en `/admin/control` y por API.
- **Guardar en caja fuerte = cierre parcial** (`/cierre-parcial`, menú Vender, arriba de "Cierre de caja"): sale plata de la caja durante el día y se guarda en la caja fuerte; **se descuenta de la caja del día y suma a la caja fuerte** (`retiros_efectivo` origen `caja`, `a_caja_fuerte = true`, destino fijo "Caja fuerte"). No se puede si el cierre del día ya existe. En la misma pantalla, abajo, **Salida de caja fuerte** (origen `caja_fuerte`: Depósito, banco…). `/retiros` redirige ahí. Kevin insiste: el cierre parcial NO es un retiro ni un plan aparte, es guardar en caja fuerte.
- **Caja fuerte** (`/admin/caja-fuerte`, solo admin): saldo = cierres + cierres parciales (guardado) + conteos − salidas de caja fuerte. **Conteo real:** el admin cuenta y el sistema guarda la diferencia con quién y cuándo (sirve para arrancar de cero: Kevin debe hacer un conteo por sucursal antes de empezar).
- Migraciones 016, 020, 025–027 y **031** (marca `a_caja_fuerte`) aplicadas. Los 2 retiros reales viejos (San Lorenzo: $760.000 "manteca" 24/11 y $500.000 "camila asensio" 25/11, ambos destino Depósito) quedaron con la marca en false: NO cuentan en la caja fuerte; si eran plata guardada ahí, se corrige con un conteo.
- **Anular ventas** (`/ventas`): solo hoy y de su local (admin cualquier día), nunca con caja cerrada o nota de crédito; motivo obligatorio. **Origen del stock:** el depósito puede vender con stock de San Lorenzo (y la cuenta "Depósito Zelarrayan" con stock de Zelarrayan).

## 7. APIs e integraciones
- `GET /api/informes` (llaves Bearer `xmp_…`, administradas en Oficina → Accesos API; conector `app/scripts/mcp-informes.mjs` para el Claude de César), `GET/POST/DELETE /api/promos` (alcance "promos"), `GET /api/stock` (alcance "stock", para n8n; migración 019). Cada llave abre solo lo suyo.
- **Ficha (sistema de ficha de empleados; es de Antigravity; carpeta `/Users/usuario/Documents/sistema de ficha`):** el stock ya manda **compras de empleado** a la cuenta corriente (`POST /api/compras-empleado`, idempotente por referencia; variables `FICHA_URL` y `FICHA_API_KEY` en Easypanel) y lee empleados activos. Primera compra real (Mayra Rosales, $9.600, 24/11) quedó **"enviado"**; falta que Kevin confirme que se ve en la ficha (Administración → Compras → Mayra → historial). Monto = precio de efectivo. No hay "deshacer": se corrige a mano en la ficha y se ajusta el stock. La llave de automatización global de la ficha abre sueldos y personal: **no usarla**; una llave por función.
- **Ideas aún NO decididas (solo explorar, Kevin va a ordenar cómo las quiere):** más integración con la ficha (rankings diarios, gastos, comisiones) y **Tiendanube** (stock por talle vs. nuestro SKU sin talle; ver `PLAN_INTEGRACIONES.md`). No construir nada de eso sin que Kevin lo pida.

## 8. Estado al 25/11/2026
- Último push de Kevin: `78a1a64` (campos de plata con puntos automáticos). Commits recientes: `85a379e` promos por producto/a mano + "Más opciones"; `27f658a` 3x2 a mano + cortesía a la vista; `b9b0154` a mano sin productos; `457f5a0` precio de promo acepta cualquier entero; `adc6327` botón de promo sin texto repetido; `3544821` "no cargada" arriba, "Más opciones" solo si hay descuento especial; `78a1a64` puntos en campos de plata.
- Base real con migraciones aplicadas hasta la **032** (MCP remoto con login OAuth: ver PLAN_MCP_REMOTO.md).
- Kevin debe: Implementar el último push y probar.

## 9. Pendientes y cosas para retomar
1. Probar en pantalla (con sesión): Vender → botón "no cargada" arriba, cortesía suelta, promo "a mano" ($15.000 precio fijo, a mano, sin productos: tocar **Efectivo** y ver si el total baja a $15.000), 3x2 a mano, puntos en los campos de plata, Retiros, Caja fuerte (hacer un conteo por sucursal), Oficina → Promos.
2. Confirmar la compra de empleado en la ficha.
3. **Limpieza de catálogo** (después de terminar el etiquetado): hay muchos productos repetidos con errores de tipeo y precio. Herramienta propuesta en Oficina: posibles repetidos por nombre parecido y misma categoría, unir dos productos (suma stock, mueve historial, da de baja el otro, auditado, conservando ambos códigos escaneables), precios raros. **No unir SKUs antes de que terminen las etiquetas.**
4. Ofrecido y no pedido: cortesía empresarial en prendas "no cargadas" (hoy solo con stock real); confirmación de recepción en Depósito de los retiros; incluir retiros en el informe A4 de control.
5. Viejos: `GET /api/vendedores` y llave nueva de informes para César; "Traer empleados de la ficha" otra vez para desactivar a César y Guillermo como vendedores; rotar la llave de la ficha; llave "solo stock" para n8n; modo FERIA (QR por precio); el cierre de Zelarrayan del 15/11 quedó mal y se arregla aparte.
6. Integraciones (Ficha / Tiendanube): solo cuando Kevin lo decida.

## 10. Dónde está cada cosa
- Plan y decisiones: `PLAN_OPERATIVO.md`, `PLAN_INTEGRACIONES.md`, `PRUEBAS_STAGING.md`, `CONTEXTO_PARA_OTRAS_HERRAMIENTAS.txt`, `INSTRUCCIONES_API_INFORMES.txt`.
- Lógica: `app/lib/repo.ts` (ventas, stock, retiros de empresa), `app/lib/promos.ts` (cálculo de promos), `app/lib/promosAdmin.ts`, `app/lib/cierre.ts`, `app/lib/ficha.ts`, `app/lib/util.ts` (medios de pago, `fmtMonto`), `app/lib/seguridad/permisos.ts`, `app/lib/menu.ts`, `app/lib/empresa.config.ts`.
- Pantallas: `app/app/venta`, `/cierre`, `/retiros`, `/empleado`, `/carga`, `/buscar`, `/admin/*` (promos, caja-fuerte, informes, control, usuarios, accesos API). Acciones del servidor: `app/app/actions.ts` y `app/app/admin/acciones.ts`.
- Pruebas: `app/scripts/staging-probar.mts`.
- Memoria persistente de Claude (se carga sola): `/Users/usuario/.claude/projects/-Users-usuario-Documents-sistema-stock/memory/` (índice en `MEMORY.md`).

# Sistema de Stock - Plan de compatibilidad, SKU y operatoria

Objetivo: que el hardware acompañe al sistema sin fricción. Prioridad: velocidad y simpleza, no estética.

## 1. Compatibilidad de hardware

| Componente | Cómo se conecta | Cómo lo ve el sistema | Veredicto |
|---|---|---|---|
| Scanner W239 (2.4G / Bluetooth / USB) | Dongle USB 2.4G o cable | Teclado (HID). Tipea el código y manda Enter | Compatible. Probar antes de comprar los 4 |
| Etiquetadora DT01 (DETONGER P1) | Bluetooth Classic (RFCOMM) con app propia | No hay forma oficial de imprimir desde el navegador | **Riesgo alto** (ver 1.1) |
| Impresora XP-365B (plan B) | USB, driver estándar de Windows, lenguaje TSPL | Aparece como impresora normal del sistema | Compatible. Es la opción segura |
| Computadora Windows usada | Chrome actualizado | Corre la web app y recibe el scanner | Compatible |
| Celular Android (Chrome) | Cámara | Escaneo por cámara por HTTPS | Compatible, respaldo |

### 1.1 Etiquetadora DT01: hallazgo importante

- El fabricante (DETONGER) ofrece SDK solo para Android e iOS, con su app. No publica un protocolo para navegador.
- Un proyecto de la comunidad (github.com/NicoSeg735/label-printer) indica que la DT01 usa **Bluetooth Classic/RFCOMM** como transporte principal. El navegador (Web Bluetooth) **no soporta Bluetooth Classic**, así que imprimir directo desde la web app no es viable de forma limpia.
- Caminos posibles con la DT01: (a) pasar la etiqueta como imagen por su app, paso manual; (b) un programa auxiliar en la PC del depósito que use el protocolo reverso del proyecto de la comunidad (no oficial, frágil); (c) USB con driver de Windows, si el modelo lo expone como impresora (sin confirmar).
- **Decisión de diseño:** el sistema no depende de ninguna impresora en particular. Genera la etiqueta como página lista para imprimir (50x30 mm) y se imprime con el diálogo normal del navegador. Cualquier impresora con driver funciona. La XP-365B cumple eso sin vueltas.
- **Recomendación:** comprar la XP-365B como impresora principal del depósito. La DT01 queda como complemento opcional para etiquetar en cualquier lado desde el celular.

### 1.2 Scanner como teclado: reglas para que no falle

1. El scanner "tipea" el código. Si la distribución del teclado no coincide (es-AR vs US), símbolos como `-`, `/`, `'` salen mal. **El SKU usa solo letras mayúsculas y números.**
2. Si el Caps Lock está activo, las letras pueden invertirse. **El sistema normaliza todo a mayúsculas** al leer.
3. El scanner debe estar configurado con sufijo **Enter** (viene así de fábrica en la mayoría).
4. En la pantalla de escaneo el sistema escucha el teclado de toda la página y detecta ráfagas rápidas de caracteres. No hay que hacer clic en ningún campo.
5. Usar **modo 2.4G con dongle** en el depósito (más estable que Bluetooth) y cable en los locales.

### 1.3 Prueba de aceptación (antes de dar por bueno el hardware)

1. Escanear 50 etiquetas seguidas: 0 errores de lectura.
2. Escanear con Caps Lock activo y con teclado en es-AR: el SKU llega igual.
3. Imprimir 100 etiquetas seguidas: tamaño correcto, sin saltos, QR legible a 10 cm.
4. Etiqueta pegada en cartón colgante y en bolsa: se lee después de 24 h y de manipularla.
5. Perder internet 2 minutos en un local: ver cómo se comporta (ver 2).

## 2. Infraestructura

| Pieza | Decisión |
|---|---|
| Servidor | VPS de la empresa: Ubuntu 24.04 con Docker, administrado con Easypanel (ya corre Evolution API, n8n, Chatwoot y otros) |
| Base de datos | PostgreSQL propio en el VPS (ver seccion 7). Migrable a Supabase mas adelante |
| Backend y frontend | Next.js (TypeScript), una sola aplicación |
| Contenedores | Dos servicios nuevos en Easypanel, en un proyecto propio: la app (desde repositorio Git con Dockerfile) y un Postgres **dedicado** (no se comparte con n8n ni Chatwoot) |
| HTTPS | Lo resuelve Easypanel (dominio + certificado automatico). Obligatorio para camara del celular |
| Backups | Backup diario del Postgres con la funcion de backups de Easypanel, a un destino fuera del VPS; prueba de restauracion mensual |
| Recursos | VPS Hostinger (4 cores, 15,6 GB RAM, 192,7 GB disco). Segun el panel: CPU ~36%, RAM 22% (3,4 GB usados), disco 15,5%. **Hay lugar de sobra** para la app y su Postgres; si crece, se puede ampliar el plan |
| Dominio | `sistema-stock.xmenosmasprendas.com`, con HTTPS y login obligatorio en todas las pantallas |
| Seguridad | Login con usuario y contrasena (hash), sesiones con vencimiento, roles, limite de intentos fallidos, registro de quien hizo cada movimiento. El panel de Easypanel hoy se abre por `http://IP:3000` sin HTTPS: conviene ponerle dominio con HTTPS o restringir el puerto 3000 |
| Usuarios | Roles: admin, depósito, vendedor (por sucursal). Todo movimiento guarda usuario y hora |
| Sin internet | Riesgo real: si un local se queda sin internet no puede vender. En la primera versión se avisa y se anota a mano; después se agrega cola offline |

## 3. SKU automatico (decision: sin talle ni color; el MODELO y el PRECIO definen el producto)

Problema real: dentro de un mismo tipo (jeans) hay muchisimos modelos distintos y cada uno tiene su precio (ej: jean wide leg dama $17.500 vs. otro modelo a $30.000). Etiquetar solo por tipo no alcanza. Ademas, casi ninguna prenda se repite entre lotes (viene de La Salada, segun lo que venden esa semana), asi que **la mayoria de los SKU van a tener pocas unidades**. La carga tiene que estar pensada para hacerse rapidisimo, casi prenda por prenda.

**Un producto = tipo + descripcion del modelo + precio.** Cada producto recibe su propio SKU.

Formato: `TIPO(3) + NUMERO(6)`, correlativo por tipo (6 digitos porque se van a crear muchisimos SKU).

Ejemplos:
- `JEA000001` = Jean wide leg dama, $17.500
- `JEA000002` = Jean recto hombre, $30.000
- `REM000001` = Remera oversize, $9.000

Reglas:
- Solo letras mayusculas y numeros. Sin guiones ni simbolos.
- Talle y color NO forman parte del SKU ni de la etiqueta.
- **Mismo tipo + misma descripcion + mismo precio = mismo SKU.** Si llega otra tanda del mismo modelo al mismo precio, el stock se suma al producto existente.
- Descripcion corta escrita al cargar (ej: "wide leg dama"). **Es opcional**: si se deja vacia, queda el nombre del tipo y el precio. El sistema la normaliza (mayusculas, sin tildes, sin espacios dobles) y **sugiere modelos ya cargados mientras se escribe** para no duplicar por errores de tipeo.
- Si es un modelo nuevo, el sistema crea el SKU siguiente solo.
- El QR contiene **solo el SKU**. Precio y stock viven en la base.
- La etiqueta muestra: QR + SKU grande + descripcion + precio.
- Si un precio cambia, en la venta manda el precio del sistema (se muestra en pantalla al escanear). Se puede marcar el producto como "remarcado" para saber que la etiqueta impresa tiene el precio viejo.
- Busqueda: escribir parte del SKU o de la descripcion. Resultado inmediato con stock por sucursal.

Consecuencia a tener presente: el sistema sabe cuantos "jean wide leg dama a $17.500" hay en cada sucursal, pero no de que talle ni color. Si mas adelante se quiere, se pueden sumar como datos opcionales sin cambiar las etiquetas ya pegadas.

## 4. Modus operandi (rápido y dinámico)

Principio: **ordenar por tipo y cargar con el teclado, sin tocar el mouse.** Como casi no hay prendas repetidas, la pila de un modelo suele tener 1 a 3 unidades; lo que importa es que cada carga tome pocos segundos.

### Depósito: ingreso y etiquetado

1. **Recepción del bulto.** Se crea un *lote*: proveedor, fecha, cantidad de bultos y **costo total**. Sirve para calcular el costo promedio por prenda, porque la mercadería llega sin precio por unidad.
2. **Clasificación física.** Una persona separa por **tipo de prenda** (jeans, remeras, buzos...). Si hay varias iguales y del mismo precio, se agrupan. No se separa por talle ni color.
3. **Carga rapida por teclado (meta: 5 a 8 segundos por prenda).** Tecla de acceso rapido para el tipo, se tipea el precio, cantidad en 1 por defecto, Enter. Se imprime la etiqueta y la pantalla queda lista para la siguiente. Ayudas: botones de precios frecuentes (17500, 30000...), "repetir la anterior" y descripcion opcional con sugerencias.
4. **Etiquetado.** Otra persona pega las etiquetas mientras la primera sigue cargando. Se trabaja en paralelo.
5. **Verificación.** La pila etiquetada queda registrada como stock del depósito. Un escaneo de una prenda por pila confirma que la etiqueta salió bien.

### Depósito a sucursal

1. Se arma un **remito de transferencia**: se escanea una prenda de cada pila e ingresa la cantidad, o se escanea prenda por prenda para mayor control. Los dos modos conviven.
2. Estado **"en tránsito"**: sale del stock del depósito pero todavía no cuenta en el local.
3. En el local se confirma la recepción escaneando. Si hay diferencia, el sistema la marca y avisa al encargado.

### Venta en sucursal

1. Se escanea cada prenda: el sistema muestra producto y precio, y arma el ticket.
2. Al cobrar, descuenta 1 por prenda del stock de ese local.
3. Una prenda sin etiqueta o ilegible se busca escribiendo parte de la descripcion.

### Control

- **Conteo cíclico:** cada semana se cuenta una sección y se compara contra el sistema.
- **Ajustes** (merma, robo, daño, devolución) siempre con motivo y usuario.
- **Reportes mínimos:** stock por sucursal, lo que más se vende, lo que no se mueve hace 30 días, diferencias de transferencias.

## 5. Ticket interno y ARCA

- **Ticket interno:** es solo un resumen del gasto del cliente. Lista las prendas (tipo y precio), el total, la fecha, la sucursal y el vendedor. Lleva la leyenda "No valido como factura".
- **ARCA: fuera de alcance por ahora.** Se deja la puerta abierta: el ticket tiene numeracion propia e independiente, y las ventas guardan campos opcionales (CUIT, condicion frente al IVA) vacios. Asi, sumar facturacion despues no obliga a rehacer la base.

## 5.1 Precio de lista, medios de pago y promos (muy importante)

### Precio y medio de pago
- Cada producto tiene **un solo precio: el de lista**. Es el que se carga al ingresar la prenda y el que va en la etiqueta.
- **El precio de lista equivale a pagar con transferencia.**

| Medio de pago | Ajuste sobre el precio de lista |
|---|---|
| Transferencia | 0% (precio de lista) |
| Efectivo | -20% |
| Tarjeta | +20% |

- Los porcentajes se configuran **una vez en un panel de administracion** (solo rol admin). No se cargan por producto.
- Cada venta **guarda los porcentajes y promos que se usaron ese dia**, asi cambiarlos despues no altera tickets ni reportes viejos.

### Promos
Se crean en el panel de admin, con fecha de inicio y fin, y se activan o desactivan sin tocar nada mas. Tipos:
- **Descuento porcentual** (ej: 15% en jeans).
- **NxM** (ej: 3x2): por cada grupo de N prendas elegibles, **la mas barata no se paga**.

Regla del NxM: se ordenan las prendas elegibles de mayor a menor precio y se arman grupos completos de N; en cada grupo se descuenta la mas barata. Las prendas que sobran (grupo incompleto) pagan normal.

### Orden de calculo (propuesto)
1. Subtotal a precio de lista.
2. Se aplica la promo (descuento o NxM) sobre los precios de lista.
3. Se aplica el ajuste del medio de pago (-20%, 0% o +20%) sobre el resultado.
4. Redondeo del total final (por definir).

Ejemplo: 3 prendas de $17.500, $30.000 y $17.500 (lista $65.000) con 3x2:
- Con promo: $65.000 - $17.500 (la mas barata) = **$47.500**
- Transferencia: **$47.500**
- Efectivo (-20%): **$38.000**
- Tarjeta (+20%): **$57.000**

El ticket interno muestra: subtotal de lista, promo aplicada, medio de pago, ajuste y total a cobrar.

### Control de promos
- El cajero solo puede elegir entre promos activas definidas por el admin. No puede inventar descuentos.
- Cada venta con promo queda registrada con el usuario que la aplico.

## 6. Preguntas abiertas

**Pospuesto (se define mas adelante):** calculo de promos y medios de pago.
- Ya definido: el 3x2 se calcula sobre el precio de lista.
- Pendiente: acumulacion de promos (a veces se pueden acumular), orden exacto de calculo, redondeo y pago mixto.
- El diseno de la base deja lugar para esto sin rehacer nada (cada venta guarda sus items a precio de lista y el detalle de ajustes por separado).

**Abiertas ahora:**
1. ¿Cuantas prendas entran por jueves, mas o menos? (decide cuantas etiquetas y rollos hacen falta)
2. ¿Que ven y hacen los usuarios en cada pantalla? Ver seccion 8 y ajustar con la maqueta.

Supuesto actual: la etiqueta lleva solo el precio de lista.

### Tip para acelerar el jueves
Si al cargar se **deja la descripcion vacia**, todas las prendas del mismo tipo y mismo precio comparten SKU. Mil jeans a $17.500 se cargan en una sola entrada (tipo + precio + cantidad 1000). La descripcion solo se agrega cuando se quiere distinguir un modelo puntual.

## 7. Decisiones tomadas

### 7.1 Compra de hardware por etapas

**Comprar ahora (para validar compatibilidad, ~$150.000):**
- 1 impresora XP-365B (~$100.000). Confirmar con el vendedor que es la de etiquetas, con driver para Windows (y para Mac si se quiere probar en Mac).
- 1 scanner 2D USB con cable (~$33.000).
- 2 rollos de etiquetas termicas 50x30 mm con separador (~$19.000).

**Todavia no:**
- Scanner W239 inalambrico y los otros scanners con cable (se compran cuando pase la prueba de aceptacion de la seccion 1.3).
- Las 2 computadoras usadas (fase 3, cuando el sistema este probado).
- La DT01 es opcional; si ya la tienen, se usa como complemento por su app.

### 7.2 Base de datos: PostgreSQL en el VPS

- Ya esta pago, no suma costo y los datos quedan bajo control de la empresa.
- Supabase es PostgreSQL con extras (login, panel, tiempo real). Para esta app el login y los roles se resuelven en la aplicacion, asi que los extras no son necesarios.
- Se usa PostgreSQL estandar con un ORM (Drizzle o Prisma). Asi, si despues conviene Supabase, la migracion es mover la base, no reescribir.
- Responsabilidad propia del VPS: backup diario fuera del servidor, actualizaciones y firewall.

## 8. Pantallas del sistema (primera version)

| # | Pantalla | Quien la usa | Para que |
|---|---|---|---|
| 1 | Login | Todos | Entrar con usuario y contrasena |
| 2 | Ingreso (carga rapida) | Deposito | Elegir tipo, precio, cantidad, descripcion opcional. Genera SKU e imprime etiquetas |
| 3 | Lote del dia | Deposito | Ver lo cargado en el lote, reimprimir etiquetas, corregir errores |
| 4 | Transferencia | Deposito y locales | Armar y confirmar el envio de mercaderia a una sucursal escaneando |
| 5 | Venta | Vendedor | Escanear prendas, ver total a precio de lista, cobrar, emitir ticket interno |
| 6 | Buscar producto | Todos | Buscar por SKU o descripcion y ver stock por sucursal |
| 7 | Ajustes de stock | Encargado, admin | Mermas, devoluciones, conteos, siempre con motivo |
| 8 | Administracion | Admin | Tipos de prenda, usuarios y roles, sucursales, medios de pago y promos |
| 9 | Reportes | Admin | Stock por sucursal, ventas, productos sin movimiento |

### Pantalla de ingreso: comportamiento clave
- Se maneja con teclado: tipo, precio, cantidad y Enter.
- Si ya existe una prenda con el mismo tipo, descripcion y precio, **reutiliza el SKU** y suma stock. Si no, crea el siguiente numero del tipo.
- Muestra la etiqueta tal como va a salir antes de imprimir.
- Botones de precios frecuentes para no tipear.

### Referencias para ver como funcionan sistemas parecidos
Conviene mirar videos o demos de: Odoo (modulo Inventario y Punto de venta), Square for Retail, Shopify POS y Zoho Inventory. No hay que copiarlos: solo ver como manejan alta de producto, escaneo en caja y stock por sucursal.

## 9. Pensar el sistema para otras empresas (generalizacion)

Decision: **no se arma multi-empresa ahora.** Se construye para esta empresa, pero todo lo especifico vive en un archivo de configuracion (`app/lib/empresa.config.ts`): nombre, sucursales, tipos de prenda con su codigo, precios frecuentes y digitos del SKU. Nada de eso esta escrito dentro de las pantallas.

- **Camino simple para vender a otra empresa:** una instalacion separada por empresa (otro servicio en Easypanel con su propia base). Es la forma mas segura y no complica el codigo.
- **Camino avanzado (mas adelante, si hay demanda):** multi-empresa en una sola instalacion, con un `empresa_id` en cada tabla. Es mas trabajo y mas riesgo de mezclar datos, por eso se deja para despues.
- Lo que hoy es de ropa (tipos de prenda) en realidad es generico: "tipo de producto". Talle y color quedaron afuera a proposito, lo que ayuda a que sirva en otros rubros.

## 10. Estado del front (2 de octubre)

Prototipo en `app/` (Next.js, TypeScript). Guarda los datos en el navegador (sin base todavia, para probar el flujo). Pantallas: ingreso con etiqueta e impresion, venta con escaneo, buscar con stock por sucursal. Foto opcional con miniatura local.
Pendiente: login, transferencias, base de datos Postgres, ajustes de stock, administracion, promos y medios de pago.

## 11. Formato del codigo en la etiqueta: Code128 o QR

Decision actual: **Code128 (codigo de barras)** como formato por defecto. El SKU es corto, el formato es el estandar de comercios, lo lee cualquier scanner (tambien los 1D, mas baratos) y se imprime bien en termica. El QR queda disponible: se cambia con `codigoEtiqueta` en `app/lib/empresa.config.ts` (`"code128"` o `"qr"`).
La eleccion final la define la prueba con la impresora y el scanner reales (seccion 1.3): imprimir 100 etiquetas de cada formato, pegarlas en cartoncito y bolsa, y escanearlas a velocidad de caja. El QR se queda si tolera mejor las etiquetas arrugadas.

## 12. Nombre libre, sugerencias y nombre interno con fecha

- **Carga con nombre libre:** se escribe el nombre completo ("remera oversize lisa"). El tipo (REM, CAM...) se detecta solo por la palabra ("remera", "campera"...) y se puede corregir con botones. Si no se reconoce, queda como "Otro" (OTR).
- **Sugerencias:** mientras se escribe, aparecen las prendas ya cargadas con su precio, SKU y fecha. Se elige con flechas y Enter, y se completa el precio. Si ya existia, se suma al mismo SKU.
- **Mismo nombre, otro precio:** (ej: campera boxyfit $28.000 hoy y $29.000 la semana siguiente) el SKU es distinto, asi que nunca se mezclan. El sistema avisa al cargar: "Ya hay Campera boxyfit a $28.000. Con este precio se crea un producto aparte".
- **Nombre interno:** en pantallas internas (lote, venta, buscar) cada producto se ve como `Campera boxyfit · ing 02/10`, con la fecha de primer ingreso. La fecha **no sale en la etiqueta ni en el ticket**.
- Cada ingreso (fecha y cantidad) queda registrado por producto, para saber cuando entro cada tanda.
- **Medida de la etiqueta:** configurable en `etiquetaMm` (`app/lib/empresa.config.ts`). Hoy 50x30 mm. Hay que fijarla segun la impresora y el rollo reales.

## 13. Carga (deposito) e Ingreso (local): SKU por modelo, stock por cantidad

- **El SKU es por modelo** (nombre + precio). Tres modelos distintos tienen tres SKU distintos. Las prendas iguales comparten SKU: 29 remeras iguales = un SKU y 29 etiquetas con el mismo codigo de barras. **No hay codigo por prenda.**
- **Carga (deposito):** se crea el producto, se suma el stock al deposito y se imprimen las etiquetas.
- **Ingreso (local):** en el local se pickea cada prenda escaneandola. Cada escaneo pasa 1 unidad del deposito (o de donde haya stock) a ese local. Asi se sabe cuantas prendas de cada SKU hay en cada local.
- **Proteccion contra escaneos de mas:** si ya no quedan unidades fuera de ese local, el sistema avisa y no suma. Hay "Deshacer ultima" para errores.
- **Limite conocido:** como las prendas iguales comparten codigo, el sistema no puede saber si se escaneo dos veces la misma prenda fisica; solo controla que no se ingresen mas unidades de las cargadas.
- **Venta:** se escanea, descuenta del stock del local. Si el local no tenia registrada esa prenda (no se hizo el ingreso), avisa "Sin stock en este local" pero deja vender, y el stock del local queda en negativo para poder detectar el descuadre.
- **Codigo de barras:** codifica el SKU (ej. REM000001). Probar con la impresora real que se lee bien a esa densidad.

## 14. Distribucion a los locales desde la carga

- **Sucursales reales:** Depósito, Zelarrayan, White y San Lorenzo (se cambian en `app/lib/empresa.config.ts` y en el seed de `db/001_schema.sql`).
- **Reparto en la carga:** al cargar (ej. 50 remeras) se indica cuantas van a cada local (20 / 20 / 10). El sistema las da por presentes en esos locales desde ese momento, sin escanear nada en el local. Lo que no se envia queda en el deposito. No deja enviar mas de lo cargado.
- **Pantalla Distribuir:** para enviar despues stock que quedo en el deposito (elegir prenda, cantidades por local, Enviar). Valida contra el stock real del deposito.
- **Venta:** al escanear el SKU en un local, descuenta de ese local. No hace falta haber escaneado la prenda al llegar.
- **Ingreso (local):** queda como alternativa opcional para registrar prenda por prenda lo que llega y todavia figura en el deposito. Solo toma stock del deposito, nunca de otro local, asi no se "roba" stock a otra sucursal.
- **Historial:** cada reparto queda como movimiento `envio` (deposito a local) con fecha.

## 15. Mover stock entre sucursales (traslados)

- La pantalla **Distribuir** pasó a ser **Mover** (`/mover`) y sirve para cualquier origen y destino: deposito a local, **local a local** (ej. White a Zelarrayan para terminar de vender) y local de vuelta al deposito.
- Por defecto el origen es la sucursal elegida arriba a la derecha. Se elige la prenda, cuantas van a cada destino y se aprieta Mover.
- No deja mover mas de lo que hay en el origen ni mover a la misma sucursal.
- Historial: desde el deposito es un movimiento `envio`; entre locales o de vuelta al deposito es `traslado` (con fecha; el usuario se suma cuando exista el login).
- Se mantiene el criterio de "ya esta ahi": al mover, el stock figura de inmediato en el destino. Mas adelante se puede agregar un estado "en camino" con confirmacion de recepcion si hace falta.
- Pendiente con el login: permisos (quien puede mover desde que sucursal) y registro del usuario en cada traslado.

## 16. Conexion a Postgres y gestion de productos (2 de octubre)

- **App conectada a la base `sistema_stock`** (usuario `stock_app`, dueño de las tablas). La conexion se define en `DATABASE_URL` (`app/.env.local`, fuera del control de versiones). Todo el acceso a datos esta en el servidor (`app/lib/repo.ts` + `app/app/actions.ts`); las pantallas ya no guardan nada en el navegador.
- **Transacciones:** cada carga, traslado, ingreso y venta se guarda completo o no se guarda (stock, movimiento e historial juntos).
- **El precio de la venta sale siempre de la base**, nunca de lo que mande la pantalla.
- **Buscar** ahora permite: **Editar** (nombre y precio; las ventas viejas conservan los datos originales), **Ajustar stock** (por sucursal, con motivo obligatorio, queda como movimiento `ajuste`) y **Eliminar** (baja logica: se oculta pero el historial se conserva; el stock restante se da de baja con un ajuste "Producto eliminado").
- **Migracion `db/003_baja_logica.sql`:** agrega `activo` y `eliminado_en` a productos y hace que la unicidad (tipo, nombre, precio) valga solo entre productos activos.
- **Pendiente antes de publicar (obligatorio):**
  1. **Login y roles.** Las acciones del servidor se pueden invocar por POST directo; hoy no verifican usuario (marcado con TODO en `actions.ts`).
  2. **Conexion segura.** El servidor Postgres no admite SSL; desde la Mac el trafico a la base viaja sin cifrar. Es aceptable solo con datos de prueba. Al desplegar la app dentro de Easypanel se usa la red interna (`evolution_postgres:5432`) y se cierra el puerto 5432 externo.
  3. **Backups** que incluyan la base `sistema_stock`.
  4. **Fotos:** hoy se guardan como miniatura dentro de la columna `foto_url`. Mas adelante, archivos en disco.

## 17. Ticket impreso, respaldo manual y fotos (5 de octubre)

- **Ticket impreso:** al cobrar, el boton "Imprimir ticket" arma un ticket de 80 mm (`ticketMm` en `app/lib/empresa.config.ts`): nombre de la empresa, sucursal, numero de venta, fecha, prendas, total y "Ticket interno. No valido como factura". El tamano de pagina se aplica al imprimir (`app/lib/imprimir.ts`), asi etiquetas y tickets conviven. **Sin probar en una impresora real.** Necesita rollo continuo de papel termico (no etiquetas) y el driver en modo continuo.
- **Etiquetas y tickets no pueden compartir rollo a la vez:** el deposito imprime etiquetas; los locales imprimen tickets. Cada local necesita su impresora de ticket (otra XP-365B o una impresora de ticket mas simple). A decidir.
- **Respaldo manual:** `npm run respaldo` (en `app/`) guarda todas las tablas en `respaldos/stock-FECHA.json`. Solo lee de la base. Es un parche hasta tener backups automaticos del servidor.
- **Fotos (propuesta, falta aprobacion porque cambia la base):** guardar dos versiones, una miniatura de ~160 px en WebP (< 10 KB) para las listas y una imagen de ~800 px en WebP (40 a 80 KB) en una tabla aparte, servida solo al abrir el detalle. Migracion `004`. La camara del celular recien se puede usar cuando la app este desplegada con HTTPS.

## 18. Categorias libres (5 de octubre)

- **La categoria ya no es una lista fija.** En la Carga hay un campo "Categoria" con autocompletado y botones con las mas usadas. Se puede escribir cualquiera (gabardina, bermuda, lo que sea).
- **Si la categoria no existe, se crea sola** al guardar, con un codigo de 3 letras derivado del nombre (Gabardina = GAB). Si el codigo ya esta usado, prueba otra combinacion (Gaban = GAA). Cada categoria nueva arranca su propia numeracion de SKU.
- **Deteccion automatica:** si el nombre contiene una categoria conocida ("pantalon de gabardina" = Pantalon), la categoria se completa sola. Las categorias nuevas tambien se detectan a partir de ese momento (nombre y plural).
- **Sin categoria:** si no se escribe ninguna y el nombre no coincide con ninguna, queda como "Otro" (OTR). Nunca bloquea la carga.
- **El nombre de la prenda es exactamente lo que se escribe.** La categoria solo define el prefijo del SKU; no se agrega al nombre ni a la etiqueta.
- Las categorias se guardan en la tabla `tipos` (datos, sin cambios de esquema). Pendiente: pantalla para renombrar o unir categorias.

## 19. Impresora comprada: Xprinter 410B (5 de octubre)

- **La impresora que se compro es la Xprinter 410B (XP-410B), de 4 pulgadas**, no la XP-365B investigada antes. Es una impresora de etiquetas de envio, termica directa, 203 dpi.
- **Especificaciones (segun fabricante y publicacion):** etiquetas de 25,4 a 118 mm de ancho; largo de 10 mm a 1778 mm; ancho maximo de impresion 104 a 108 mm; espesor de material 0,06 a 0,25 mm; nucleo del rollo de 25,4 a 76,2 mm; diametro maximo del rollo 101,6 mm; emulacion TSPL, ZPL, EPL y DPL; drivers para Windows, Linux y Mac; imprime Code128 y QR.
- **"25x110" era el rango de ancho, no una medida fija.** La etiqueta del sistema sigue siendo **50 x 30 mm** (`etiquetaMm`), que entra en ese rango. No hay que cambiar nada.
- **Rollo a comprar:** termicas, 50x30 mm, con separador, adhesivo permanente, unas 1.000 por rollo.
- **A verificar con la impresora real:** instalacion del driver (las opiniones dicen que no hay tutorial claro), calibracion del sensor con etiqueta de 50 mm, alineacion horizontal (la impresora es mas ancha que la etiqueta) y nitidez del codigo de barras.
- **Ticket de 80 mm:** tambien entra en el rango de ancho; requiere rollo continuo y modo continuo en el driver. Sin probar.

## 20. Traslados con aviso y recepcion, recarga y precio en efectivo (5 de octubre)

- **Traslados con aviso (migracion `db/004_traslados.sql`, ya aplicada):** cuando se envia mercaderia (desde la Carga con reparto o desde Mover), el stock **sale del origen y queda "en camino"**; no suma en el destino hasta que ese local la recibe. Cada envio es un registro en la tabla `traslados` (cantidad, recibidas, origen, destino, estado en camino / recibido / devuelto).
- **Aviso al local:** en el encabezado, junto a "Ingreso", aparece una insignia roja con las unidades pendientes de recibir en la sucursal elegida (se actualiza cada 30 segundos). Ahi se ve la lista "Te enviaron".
- **Recepcion (pantalla Ingreso):** se recibe escaneando cada prenda (suma de a 1 contra el traslado pendiente mas viejo) o con "Recibir todo". "Deshacer ultima" retrocede una unidad. Si el local ya recibio todo lo enviado, un escaneo de mas se rechaza. "Devolver" regresa lo que falta al origen.
- **Visibilidad:** Buscar muestra "+N en camino" en la sucursal destino; Depósito muestra una tabla "En camino" con opcion de cancelar el envio; Venta avisa si el local no tiene stock pero hay unidades en camino sin recibir.
- **Movimientos:** `envio`/`traslado` = salida del origen; `recepcion` = entrada al destino; `deshacer` = devolucion o recepcion deshecha. Cuenta de control: en stock + en camino = cargado - vendido - ajustes.
- **Recarga de stock existente:** si se carga una prenda con el mismo nombre, categoria y precio, se suma al mismo SKU y la fecha de ingreso pasa a hoy. La fecha "ing" que se ve junto al nombre es la del **ultimo ingreso**. En Buscar, "Ingresos" muestra el historial de fechas y cantidades. En la Carga, al elegir una sugerencia aparece "Recarga: ya existe (hay X en total, ultimo ingreso …)".
- **Precio en efectivo:** la etiqueta imprime **Transferencia: (precio de lista)** y **Efectivo: (lista menos 20%, calculado)**. El porcentaje sale de la tabla `medios_pago` (hoy efectivo -20%); `etiquetaMedios` en la configuracion define cuales se imprimen. Tambien se ve en la Carga, Buscar y el total de la Venta. Redondeo al peso (pendiente: redondear a $50 o $100).
- **Pantalla Depósito:** prendas guardadas, modelos distintos y valor a precio de lista, lo que esta en camino y la lista de lo guardado.
- **Pendiente:** aviso por WhatsApp al local cuando se envia mercaderia (se podria hacer con n8n / Evolution API que ya estan en el servidor); permisos y usuario en cada movimiento (login); fotos en dos tamanos.

## 21. Cobro con 3 medios de pago (5 de octubre)

- **Venta:** despues de escanear, se ve el subtotal a precio de lista y tres botones con el monto exacto de cada medio: **Transferencia** (precio de lista), **Efectivo** (-20%) y **Tarjeta** (+20%). Hay que elegir uno; el boton "Cobrar" muestra el monto y el medio ("Cobrar $ 36.800 · Efectivo") y no se habilita hasta elegir.
- **Calculo en el servidor:** el total = subtotal de lista +/- el porcentaje del medio, tomado de la tabla `medios_pago` (nunca de la pantalla). Redondeo al peso (pendiente: $50 o $100).
- **Se guarda en `ventas`:** medio de pago, subtotal de lista, monto del ajuste, porcentaje usado ese dia y total cobrado. Los items conservan nombre y precio de lista de ese momento.
- **Ticket de 80 mm:** subtotal de lista, el ajuste del medio de pago, total y "Paga con". Ticket interno, no valido como factura.
- **Caja de hoy** (en la pantalla de Venta): ventas y total cobrado por medio de pago de la sucursal, con el dia segun hora de Argentina.
- **Pendiente:** promos (3x2 sobre precio de lista; a veces acumulables), pago mixto (parte en efectivo y parte con tarjeta o transferencia), cierre de caja con diferencias, y **calibrar y probar la impresora y el lector reales**.

## 22. Stock ficticio para probar (5 de octubre)

- `npm run demo:cargar` (en `app/`) carga un stock **ficticio**: 26 productos en 9 categorias (incluye Vestido y Pollera, creadas como categorias nuevas), recargas en dos fechas, reparto a los 3 locales, envios todavia en camino a San Lorenzo y 18 ventas con los tres medios de pago (9 de hoy). Se niega a correr si ya hay productos.
- `npm run demo:borrar` borra **solo** esos productos y sus ventas, movimientos y envios (usa `app/scripts/demo-skus.json`). Si despues no queda ningun producto, reinicia los contadores de SKU. **Correrlo antes de empezar a cargar mercaderia real.**

## 23. Venta: solo lo del local y pago con mas de un medio (5 de octubre)

- **Solo se vende lo que hay en la sucursal elegida.** En Venta, las sugerencias por nombre muestran unicamente prendas con stock en ese local (las que mas tienen, arriba) y escribir o escanear el SKU de una prenda sin stock ahi se rechaza con un mensaje que dice donde si hay ("Campera puffer no tiene stock en San Lorenzo. Hay 4 en Depósito, 1 en Zelarrayan…") y si hay unidades en camino a ese local (hay que recibirlas en Ingreso). No se puede superar el stock del local con la cantidad. Al cambiar de sucursal el carrito se vacia. **El servidor repite la validacion** (con el stock bloqueado) y rechaza la venta si falta stock; ya no queda stock negativo por ventas.
- **Busqueda por nombre en Venta:** escribir "jean" muestra la lista con precio y stock; se elige con click, flechas y Enter, o Enter toma la primera.
- **Pago con mas de un medio (migracion `db/005_venta_pagos.sql`, aplicada):** cada pago es la plata que el cliente entrega en un medio; ese monto cubre una parte del valor de lista con el ajuste de ese medio; **un medio paga el resto**. Ejemplo: lista $100.000, transferencia $50.000 (cubre $50.000) + efectivo el resto: $50.000 x 0,80 = $40.000. **Total cobrado $90.000.** Si la plata entregada es en efectivo, cubre menos lista (ej. $50.000 en efectivo cubre $62.500).
- **Calculo unico:** `calcularPagos` (en `app/lib/util.ts`) lo usan la pantalla (para mostrar el desglose antes de cobrar) y el servidor (que lo recalcula con los porcentajes de la base).
- **Se guarda:** `ventas` (subtotal de lista, ajuste total, total) y `venta_pagos` (un renglon por medio con monto, valor de lista cubierto y porcentaje usado). `ventas.medio_pago_id` queda solo si pago con un unico medio.
- **Ticket y caja de hoy:** el ticket lista cada pago; la caja del dia suma la plata cobrada en cada medio (una venta mixta cuenta en cada medio que uso).
- **A confirmar con el negocio:** que el descuento/recargo aplique solo a la parte pagada con cada medio, y si el monto que se carga es la plata realmente entregada.

## 24. Vuelto en efectivo y pago mixto simplificado (5 de octubre)

- **Pago mixto automatico:** al tocar "Pagar con mas de un medio", **Efectivo ya viene marcado como el medio que paga lo que falta** (se puede cambiar con el circulo). Al escribir lo que entrega el cliente en los otros medios, el monto del resto se calcula en vivo.
- **Vuelto:** cuando hay una parte en efectivo (pago solo en efectivo o mixto) aparece "Efectivo a cobrar", el campo "El cliente entrega" y botones "Justo" y los billetes redondeados mas cercanos (hasta $1.000, $5.000, $10.000, $20.000). Muestra **Vuelto** o **Falta**; si entrega menos, no deja cobrar.
- **Ticket:** si se cargo cuanto entrego el cliente, el ticket agrega "Efectivo recibido" y "VUELTO". Ese dato es solo para mostrar en el momento: **no se guarda** en la base (la caja registra el monto cobrado en efectivo, no el billete entregado).
- Al cambiar de modo de pago se borra el monto entregado.

## 25. Cobro mixto rehecho: primero lo que entrega el cliente (6 de octubre)

- **Flujo nuevo ("Pagar con más de un medio"):** (1) se elige el medio y se escribe **cuánta plata entrega el cliente primero** (por defecto Efectivo); el sistema muestra cuanto valor de lista cubre; (2) se elige **con que medio paga el resto** (por defecto Transferencia) y aparece **cuanto tiene que entregar** ahi. Se muestra el total y el descuento o recargo sobre el precio de lista. Si lo entregado cubre todo, avisa que use un solo medio.
- **Regla de la cuenta (coincide con las etiquetas):** el efectivo vale lista x 0,80, la tarjeta lista x 1,20 y la transferencia es la lista. Entonces $50.000 en efectivo cubren **$62.500** de lista (50.000 / 0,80), no $60.000.
- **Ejemplos con lista $100.000:** efectivo $50.000 + transferencia el resto = $50.000 + $37.500 = **$87.500**. Tarjeta $50.000 (cubre $41.667) + transferencia el resto $58.333 = **$108.333**. Transferencia $50.000 + efectivo el resto = $50.000 + $40.000 = **$90.000**.
- **Vuelto:** solo aparece cuando el efectivo es el medio que paga el resto (su monto es un calculo); si el efectivo es lo que entrega primero, ya es el monto exacto.
- Soporta dos medios por venta (el caso comun). El servidor y la base no cambian: se sigue usando `calcularPagos` y `venta_pagos`.

**Confirmado por el negocio (6 de octubre):** la cuenta correcta es la **Regla A**: el efectivo es el precio de lista menos 20% (una prenda de $100.000 se paga con $80.000 en efectivo) y, en un pago mixto, $100.000 en efectivo cubren $125.000 de lista. La etiqueta, la venta y el cobro mixto usan esta misma cuenta. No hay que cambiar nada.

## 26. Impresion del ticket en los locales (6 de octubre)

- **Cada local necesita su impresora de tickets de 80 mm** (3 en total: Zelarrayan, White y San Lorenzo). La Xprinter 410B es de etiquetas y se queda en el deposito.
- **Que comprar:** impresora termica de tickets (comandera) **80 mm, USB, con autocortador**, Xprinter (modelos XP-80C, XP-Q200 o XP-N160II; todos con driver para Windows, Mac y Linux). Precios vistos en MercadoLibre Argentina: de unos $75.000 a $140.000 segun modelo. Rollos de papel termico de 80 mm.
- **Como imprime el sistema:** el boton "Imprimir ticket" de la Venta usa la impresora del sistema con pagina de 80 mm de ancho y alto automatico (`ticketMm` en la configuracion; 58 si se compra una de 58 mm).
- **Configuracion por PC (a verificar con la impresora real):** instalar el driver; en las preferencias de la impresora poner papel de 80 mm continuo; dejarla como impresora predeterminada; abrir Chrome con el acceso directo que lleva `--kiosk-printing` para imprimir sin ventana de confirmacion.
- **Imprimir al cobrar:** la Venta tiene la casilla "Imprimir el ticket automaticamente al cobrar (en esta PC)"; se guarda por PC y viene apagada.
- **Pendiente:** probar con una impresora real el ancho, el corte y que el driver respete el alto automatico.

# Cuentas de clientes mayoristas (Depósito) — diseño para revisar, 26/11/2026

Estado: **solo diseño, nada programado**. Kevin lo está pensando. Cuando confirme las preguntas abiertas (sección 7) se programa.

## 1. Qué es (con las palabras de Kevin)
Hay clientes mayoristas que compran **por teléfono** al Depósito. La compra va a **su cuenta** (cuenta corriente: **fiado**) y de ahí van **pagando** y se les va descontando la deuda. Es clave porque ayuda a **dar de baja la mercadería que sale y a reponer la que vuelve**.
- Cada cliente es de un **vendedor mayorista** (cartera): **Santiago Altamiranda, Mayra Rosales, Tomás Cano** (los tres ya están en `vendedores`, Depósito). La deuda la **autoriza el dueño del cliente o Tomás**.
- Se ve cuánto debe cada uno. Las cuentas las ven **Depósito y admins**, separadas por vendedor: "Clientes de Santiago", "Clientes de Mayra", "Clientes de Tomás". Una **ventana propia en el menú Vender**.
- Precios: casi siempre **Curva Plus (25%)**, pero pueden usar cualquiera.
- **Devoluciones:** no se aceptan, pero **a veces pasa** (excepción). La prenda puede volver **fallada**: se usa el procedimiento que ya existe para eso.
- **Comisión (decidido 27/11):** el vendedor dueño del cliente **comisiona cuando el cliente PAGA** (cuando entra la plata), por mes. La venta a cuenta no suma comisión hasta que se cobra; los pagos parciales suman en partes; si se anula o devuelve algo ya pagado, esa comisión se descuenta.
- **Aclarado por Kevin (26/11):** la transferencia es transferencia (se anota como tal, nunca como efectivo). **Curva Plus es precio de transferencia** (lista −25%). Santiago, Mayra y Tomás **usan el mismo sistema del Depósito**; Tomás usa la cuenta **Depósito Zelarrayan** (vende como Depósito pero descuenta stock de Zelarrayan): sus ventas a cuenta usan ese mismo mecanismo.

- **Dueño del cliente (Kevin, 27/11):** el cliente es **del vendedor que le vendió** (si vendió Santi, es cliente de Santi; se asigna en la primera venta y un admin puede cambiarlo con motivo). **La plata que entra de ese cliente es para ese vendedor.** **Solo funciona en el Depósito** (incluida la cuenta Depósito Zelarrayan de Tomás) y para admins; los otros locales no lo ven. PENDIENTE: confirmar si la comisión se acredita **al vender** o **al cobrar** (ver pregunta 1 de la sección 7).

## 2. Modelo (ledger que no se borra, como cierres y retiros)
- `clientes_mayoristas`: nombre, teléfono, nota interna, `vendedor_id` (dueño de la cartera, referencia a `vendedores`), `limite` (deuda máxima, null = sin límite), `activo`, creado por. Sin datos que no hagan falta.
- `cuenta_movimientos` (**inmutable por trigger**, solo `app.mantenimiento='on'`): `cliente_id`, `tipo` (`venta` | `pago` | `devolucion` | `ajuste`), `monto` (signo: venta = +deuda; pago y devolución = −deuda), `venta_id`/`nota`, medio del pago (efectivo/transferencia/otro), `registrado_por`, `autorizo`, `motivo`, `creado_en`.
- **Saldo = suma de movimientos** (nunca un número guardado aparte) → las cuentas siempre cierran. Saldo inicial: un movimiento `ajuste` por cada cliente con su deuda de hoy (hace falta la lista).
- `ventas.cliente_mayorista_id` (null en ventas normales) y un medio de pago especial `a_cuenta` en `medios_pago`/`venta_pagos` (no es plata cobrada).

## 3. Flujos
1. **Venta por teléfono (caja del Depósito):** en `/venta`, el Depósito elige **Cliente mayorista** (agrupado por vendedor), arma el carrito (Curva Plus u otro precio), y **"Cobrar a cuenta"**. Descuenta stock como siempre; **no entra plata a la caja del día**. Si el cliente supera su límite: se pide **autorizó** (Santiago/Mayra/Tomás/admin) y motivo, igual que el descuento especial. Ticket/remito dice "A CUENTA · Cliente · Vendedor".
2. **Pago del cliente:** pantalla **"Cobrar a cliente"** (Depósito/admin): monto + medio real (efectivo o transferencia) → movimiento `pago` (baja la deuda). **El efectivo entra a la caja del día del Depósito** (cierre de caja); la transferencia se anota como transferencia (no cuenta como efectivo para el conteo).
3. **Devolución (excepción):** solo con **autorización de un admin o Tomás** y motivo. Reutiliza la devolución existente (repone stock al Depósito; si vuelve **fallada**, va por el procedimiento de falladas), pero el crédito va a la **cuenta del cliente** (movimiento `devolucion`, baja la deuda) en vez de a una nota de crédito suelta.
4. **Ajuste:** corrección de un admin con motivo (queda a su nombre).

## 4. Pantallas
- **Menú Vender > "Clientes mayoristas"** (permiso Depósito y admin): tres bloques o pestañas **Santiago / Mayra / Tomás**, cada cliente con **deuda actual, límite, última compra, último pago**; botón **Ver cuenta** (movimientos, estado de cuenta imprimible A4/ticket), **Registrar pago**, **Nueva venta a cuenta**.
- **Vista admin (Oficina):** deuda total y por vendedor, quién se pasa del límite, antigüedad de la deuda (alerta sin pago hace N días).
- Alta/edición de clientes (nombre, teléfono, vendedor, límite): Depósito la autorización la da el dueño del cliente o Tomás (el sistema registra quién lo cargó).

## 5. Cómo se cuenta (esto es lo delicado)
- **Cierre de caja y control diario:** la venta a cuenta **no es efectivo ni cobrado en caja**. Va en un renglón aparte ("vendido a cuenta") para que el cierre del Depósito no dé falsos faltantes/sobrantes. Los pagos de clientes en efectivo **sí** suman al efectivo esperado del día.
- **Informes:** separar **vendido** (incluye a cuenta) de **cobrado** (caja + pagos de cuentas). Agregar tipo de informe `cuentas_clientes` (deuda por vendedor y cliente) para el MCP/Claude (solo lectura).
- **Comisiones:** la comisión de mayoristas se acredita **al cobrar** (cada pago del cliente suma al vendedor dueño, en el mes en que entró). Hoy las comisiones de los locales son **por semana** (1%/1,5%); los mayoristas van **por mes**: falta confirmar el porcentaje. En informes, lo vendido a cuenta sin cobrar se ve aparte como "pendiente de cobro".
- Anular una venta a cuenta: ya existe anular (hoy, solo con la caja abierta); hay que devolver también el movimiento a la cuenta (movimiento de ajuste automático con el motivo).

## 6. Seguridad y control
- Todo movimiento queda **a nombre de quién lo hizo** y en la Auditoría; los movimientos no se editan ni se borran.
- Límite de deuda por cliente; superarlo exige autorización registrada.
- Solo Depósito y admins ven las cuentas. Los locales (Zelarrayan, White, San Lorenzo) no.
- Pruebas en la copia (staging) con: venta a cuenta, pago en efectivo y transferencia, devolución, falladas, límite, anulación, cierre de caja del Depósito, comisiones; migración en la real **antes** de desplegar.

## 6b. Precio en una venta a cuenta — DECIDIDO con Kevin (26/11)
**El medio de pago se ACUERDA al vender y el precio sale con ese medio**, igual que una venta normal del Depósito: transferencia = lista (Curva Plus: lista −25%); efectivo = además −20%. "Si no, es imposible": el cliente tiene que saber el precio final antes de comprar.
- La **venta a cuenta guarda el medio acordado** y el total en pesos en ese medio. El remito lo dice: "Precio acordado: $X pagando en efectivo/transferencia".
- **La deuda se lleva en "valor de lista" (ya con Curva Plus)** y se muestra en pesos de cada medio ("debe $7.500 en transferencia / $6.000 en efectivo"). Es el mismo mecanismo que ya usan el pago mixto y las notas de crédito (`valorLista` de cada pago).
- **Si paga con el medio acordado:** el pago cubre exactamente lo que se acordó. **Si paga con otro** (acordó efectivo y manda transferencia): el sistema **convierte solo** con los porcentajes de cada medio (como un pago mixto) y la diferencia queda a la vista y registrada; no hay que discutir ni corregir a mano.
- **Curva Plus por defecto** en los clientes mayoristas (queda configurado en la ficha del cliente: nivel de precio habitual = Curva Plus 25%; puede cambiarse en una venta con autorización).
- La transferencia se anota como transferencia (nunca como efectivo): el conteo de efectivo de la caja del Depósito no se descuadra.

## 6c. Cómo se le explica al cliente
- **Oferta:** "Mayorista: 25% menos que la lista. Pagando en transferencia es ese precio; en efectivo, 20% menos todavía. Lo acordamos ahora, queda en tu cuenta y pagás cuando puedas."
- **Antes de confirmar** el vendedor le dice el **total final y el medio acordado**.
- **Por escrito:** remito a cuenta (PDF/ticket) con prendas, precio unitario, total, medio acordado, **saldo anterior y saldo nuevo**; **estado de cuenta** imprimible; **texto copiable para WhatsApp** (el sistema no envía nada solo).
- **Plazo:** **no hay plazo estimado** (Kevin). Entonces no hay "vencimiento" automático ni interés. El control real es el **límite de deuda** por cliente (autoriza el dueño del cliente o Tomás) y la **antigüedad** (días desde el último pago y desde la compra más vieja sin pagar) a la vista en el listado.

## 7. Preguntas abiertas (para Kevin)
1. **Comisión de mayoristas:** se acredita al cobrar, por mes, al vendedor dueño del cliente. Falta el **porcentaje** (¿1% de lo cobrado en el mes?).
2. **Deudas actuales** a cargar de entrada: lista de clientes, vendedor dueño y monto (para el saldo inicial).
3. **Quién registra un pago:** ¿solo Depósito, o también admins desde Oficina?
4. **Límite de deuda:** ¿un número por cliente (lo pone el dueño del cliente o Tomás)? ¿Hay un valor típico para arrancar?
5. (Respondidas: precio por medio acordado; Curva Plus por defecto; sin plazo; los tres vendedores usan el sistema del Depósito, Tomás con Depósito Zelarrayan.)

## ESTADO (27/11/2026): PASO 1 HECHO
- Migración `db/033_cuentas_mayoristas.sql` aplicada en dev, staging y la REAL.
- Comisión: **0,5% de lo que paga el cliente**, al vendedor dueño (`empresa.config` > `comisionMayorista.pct`); "luego arreglan ellos" (Kevin): se anota cuánto comisiona cada uno por mes en la ventana Clientes mayoristas.
- Hecho: clientes (dueño = vendedor del Depósito, límite, Curva Plus por defecto), **venta a cuenta** desde Vender (solo Depósito; medio acordado; precio con ese medio; no entra a la caja), **pagos** (efectivo/transferencia; baja la deuda por su equivalente en lista; entra a la caja del día del Depósito), **estado de cuenta**, límite de deuda con autorización, anulación de venta a cuenta, ajuste de admin (saldo inicial), informe `cuentas_clientes` (también para Claude), ticket "A CUENTA".
- Menú Vender > "Clientes mayoristas" (permiso `cuentas_mayoristas`: admin y depósito; los locales no lo ven).
- Pendiente (pasos 2 y 3): **devoluciones contra la cuenta** (hoy bloqueadas con mensaje), texto para WhatsApp y remito PDF a cuenta, alertas por antigüedad, cargar deudas iniciales (lo hace un admin con "Ajuste"), mostrar "vendido a cuenta" en la pantalla del cierre de caja (el dato ya está en `resumenDia.vendidoACuenta`).

# MCP remoto del sistema de stock (como IOL, Meta, Tiendanube) — diseño, 26/11/2026

Objetivo de Kevin: agregar el sistema como **conector** en su cuenta de Claude (y ChatGPT) con un login, y usarlo **desde cualquier dispositivo** (web, escritorio, celular), sin instalar archivos ni depender de la Mac. Hoy existe el conector LOCAL (`app/scripts/mcp-informes.mjs`, v2) que solo funciona en la Mac donde está configurado.

## Qué exige Claude (documentación oficial, leída el 26/11)
Fuente: https://claude.com/docs/connectors/building/authentication.md (mismo requisito para claude.ai, Desktop, celular, Claude Code).
- Un conector remoto usa **OAuth 2.0** (login por usuario) o **sin autenticación**. La "llave fija en un encabezado" existe solo en beta para organizaciones limitadas: no sirve para un usuario individual. Prohibido poner el token en la URL.
- Pedido sin token -> responder **401** con encabezado `WWW-Authenticate` con `resource_metadata` (un 200 con ese encabezado se ignora).
- **Protected Resource Metadata (RFC 9728):** `resource` igual a la URL del MCP (con ruta); `authorization_servers` con el emisor primero.
- **Authorization Server Metadata (RFC 8414)** accesible desde las IP de Anthropic (**160.79.104.0/21**; ojo con firewalls/WAF/Cloudflare).
- **Registro de cliente:** Dynamic Client Registration (RFC 7591, `registration_endpoint`) o CIMD. Se recomienda soportar DCR.
- **PKCE S256 obligatorio** (`code_challenge_methods_supported: ["S256"]`).
- Redirect: `https://claude.ai/api/mcp/auth_callback` (hospedado); Claude Code usa loopback (`localhost`/`127.0.0.1` cualquier puerto).
- Token endpoint acepta `application/x-www-form-urlencoded`; rotar refresh tokens; `invalid_grant` si el refresh murio. Timeouts de Claude: 10 s en descubrimiento/registro/token, 30 s en refresh. Claude renueva al recibir 401 y hasta 5 min antes de vencer.
- Transporte (HTTP "streamable" vs SSE) no lo aclara la doc de auth: usar **Streamable HTTP** (JSON-RPC por POST), que es el estandar actual.
**ChatGPT (modo desarrollador / Conectores):** acepta MCP remoto por SSE o HTTP streaming, con OAuth o sin autenticacion; requiere HTTPS publico. Los planes que lo permiten y la version exacta de OAuth que usa NO estan confirmados: verificar en el centro de ayuda de OpenAI antes de prometerlo.

## Diseno propuesto (dentro de la app Next.js, mismo dominio)
Login con la **cuenta del sistema de cada persona** (la misma de la caja/oficina): quien tiene rol admin y 2FA entra con eso; sin llaves sueltas que se pierdan. Cada conexion queda a nombre de una persona, se ve en Oficina > Accesos API y se revoca al instante.
- Rutas publicas (agregar a la lista permitida de `proxy.ts`):
  - `GET /.well-known/oauth-protected-resource` (y la variante con ruta `/mcp`)
  - `GET /.well-known/oauth-authorization-server`
  - `POST /oauth/register` (DCR)
  - `GET/POST /oauth/authorize` (pantalla de login + consentimiento reutilizando la sesion y el 2FA existentes; solo rol admin; emite `code` de un solo uso, 10 min, atado a PKCE y a `redirect_uri` permitidos)
  - `POST /oauth/token` (code -> access token corto, ej. 1 h + refresh token rotativo; revocacion)
  - `POST /mcp` (Streamable HTTP, JSON-RPC: `initialize`, `tools/list`, `tools/call`, `ping`); sin token -> 401 con `WWW-Authenticate`.
- Tablas nuevas (migracion 032, aplicar ANTES de desplegar): `oauth_clientes` (client_id, redirect_uris, nombre), `oauth_codigos`, `oauth_tokens` (solo huella sha256, usuario_id, alcance, vence_en, refresh, revocado_en, ultimo_uso). Nada en claro.
- Las herramientas llaman directo a `lib/informes.ts`, `lib/promosAdmin.ts`, `lib/comisiones.ts`, stock: misma logica que la API. Reutilizar la lista de herramientas de `mcp-informes.mjs` (consultar_informe, estado_del_dia, ver_comisiones, buscar_prenda, ver_catalogo, ver_promos, crear_promo, desactivar_promo).
- **Reglas que no se negocian:** SOLO LECTURA de plata (nada de cierres, retiros ni caja fuerte en escritura); escritura solo promos y solo admin; limite de pedidos por usuario (30/min); cada llamada a la Auditoria con el usuario; revocar desde Oficina; HTTPS; sin datos personales (DNI, sueldos).
- Pantalla en Oficina > Accesos API: lista de "Conexiones de Claude" (persona, dispositivo/cliente, ultimo uso, revocar).

## Pruebas
- Staging con un cliente OAuth simulado: registro DCR -> authorize (con PKCE) -> token -> `tools/list` -> `tools/call` de un informe -> refresh rotativo -> revocar -> 401. Casos negativos: code reusado, PKCE equivocado, redirect_uri no registrado, token vencido, rol no admin, token en la URL.
- Probar el flujo real: agregar el conector en claude.ai (Ajustes > Conectores > Agregar conector personalizado) apuntando a la URL del MCP, en la copia de pruebas expuesta o directo en produccion con una cuenta de prueba.

## Preguntas abiertas / riesgos
- Si hay Cloudflare u otro filtro delante del dominio, permitir `160.79.104.0/21` y las rutas `/.well-known`, `/oauth` y `/mcp`.
- Confirmar el plan de ChatGPT de Kevin y su soporte OAuth.
- Lo hace Claude (no Antigravity). Es codigo de seguridad: revisar dos veces y probar en staging antes de produccion.
- Cuentas de local (una por sucursal) NO pueden conectar: solo admins (Kevin, Guillermo, Cesar si se le crea usuario admin).

## ESTADO (26/11/2026): HECHO
- Migración `db/032_oauth_mcp.sql` aplicada en dev, staging y la REAL.
- Código: `app/lib/oauth.ts` (registro, autorización, canje con PKCE, refresco rotativo con detección de reuso, revocación, verificación),
  `app/lib/mcp/` (herramientas, servidor JSON-RPC, CORS), `app/lib/stockConsulta.ts` (lógica compartida con /api/stock),
  rutas `/.well-known/oauth-protected-resource[/mcp]`, `/.well-known/oauth-authorization-server`, `/oauth/{register,authorize,token,revoke}`, `/mcp`,
  pantalla `/conectar` (Permitir/Cancelar, solo admin), `proxy.ts` (deja pasar el conector sin cookie), login que conserva la vuelta a través del código de seguridad,
  Oficina > Accesos API: "Conexiones de Claude / ChatGPT" con botón Cortar.
- Probado: flujo real en el navegador (login admin -> Permitir -> código -> tokens -> 8 herramientas -> refresco -> reuso detectado -> corte) y 375 pruebas OK en staging.
- Para conectar: en claude.ai > Ajustes > Conectores > Agregar conector personalizado > URL `https://stock-caja-ventas.xmenosmasprendas.com/mcp`.
- Si la metadata real devolviera `http://` en vez de `https://`, cargar la variable `PUBLIC_URL=https://stock-caja-ventas.xmenosmasprendas.com` en Easypanel.

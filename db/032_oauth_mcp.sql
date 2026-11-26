-- MCP remoto con login (OAuth 2.0 + PKCE), para conectar el sistema como "conector" en Claude o ChatGPT desde cualquier dispositivo.
-- Cada persona entra con SU cuenta del sistema (solo administradores) y autoriza; queda una "conexion" a su nombre que se revoca desde
-- Oficina > Accesos API. De los codigos y tokens solo se guarda la huella (sha256): si se filtra la base, no sirven.
-- Solo crea tablas nuevas: no toca datos. Aplicar ANTES de desplegar; se puede correr mas de una vez.

-- Clientes registrados solos (Dynamic Client Registration, RFC 7591): Claude, ChatGPT, Claude Code. Solo con direcciones de vuelta permitidas.
create table if not exists oauth_clientes (
  client_id     text primary key,
  nombre        text not null check (length(nombre) between 1 and 100),
  redirect_uris text[] not null check (cardinality(redirect_uris) between 1 and 10),
  creado_en     timestamptz not null default now()
);

-- Pedido de autorizacion pendiente: entre que Claude pide permiso y la persona toca "Permitir" (vence a los 10 minutos).
create table if not exists oauth_pedidos (
  id             text primary key,
  client_id      text not null references oauth_clientes(client_id) on delete cascade,
  redirect_uri   text not null,
  code_challenge text not null,
  state          text check (state is null or length(state) <= 500),
  scope          text check (scope is null or length(scope) <= 200),
  resource       text check (resource is null or length(resource) <= 300),
  creado_en      timestamptz not null default now(),
  vence_en       timestamptz not null
);

-- Codigo de un solo uso que se canjea por tokens (vence a los 10 minutos).
create table if not exists oauth_codigos (
  huella         text primary key,
  client_id      text not null references oauth_clientes(client_id) on delete cascade,
  usuario_id     bigint not null references usuarios(id),
  redirect_uri   text not null,
  code_challenge text not null,
  scope          text,
  creado_en      timestamptz not null default now(),
  vence_en       timestamptz not null,
  usado_en       timestamptz
);

-- Una conexion por autorizacion (persona + aplicacion). Revocarla corta todos sus tokens.
create table if not exists oauth_conexiones (
  id           bigint generated always as identity primary key,
  client_id    text not null references oauth_clientes(client_id) on delete cascade,
  usuario_id   bigint not null references usuarios(id),
  creado_en    timestamptz not null default now(),
  ultimo_uso   timestamptz,
  usos         integer not null default 0,
  revocado_en  timestamptz,
  revocado_por bigint references usuarios(id),
  motivo_revocacion text check (motivo_revocacion is null or length(motivo_revocacion) <= 200)
);
create index if not exists oauth_conexiones_usuario_idx on oauth_conexiones (usuario_id);

-- Tokens de acceso (cortos) y de refresco (rotan en cada uso; si se reusa uno viejo, se revoca la conexion entera).
create table if not exists oauth_tokens (
  huella      text primary key,
  conexion_id bigint not null references oauth_conexiones(id) on delete cascade,
  tipo        text not null check (tipo in ('acceso', 'refresco')),
  creado_en   timestamptz not null default now(),
  vence_en    timestamptz not null,
  usado_en    timestamptz
);
create index if not exists oauth_tokens_conexion_idx on oauth_tokens (conexion_id);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'stock_web') then
    grant select, insert, update, delete on oauth_clientes, oauth_pedidos, oauth_codigos, oauth_conexiones, oauth_tokens to stock_web;
    grant usage, select on all sequences in schema public to stock_web;
  end if;
end;
$$;

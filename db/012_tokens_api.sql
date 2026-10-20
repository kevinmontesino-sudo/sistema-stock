-- Llaves de acceso (tokens) para la API de informes de SOLO LECTURA (por ejemplo para que Cesar la use con su Claude).
-- El token se muestra UNA sola vez al crearlo; aca solo queda su huella (sha256). Vencen y se pueden revocar.
create table if not exists tokens_api (
  id          bigint generated always as identity primary key,
  nombre      text not null,
  token_hash  text not null unique,
  prefijo     text not null,                       -- primeros caracteres, para reconocerlo en pantalla
  alcance     text not null default 'informes' check (alcance in ('informes')),
  creado_por  bigint references usuarios(id),
  creado_en   timestamptz not null default now(),
  vence_en    timestamptz not null,
  ultimo_uso  timestamptz,
  usos        bigint not null default 0,
  revocado_en timestamptz
);
create index if not exists tokens_api_vence_idx on tokens_api (vence_en);

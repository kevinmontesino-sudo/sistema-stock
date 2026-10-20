-- Codigos de nota de credito NO adivinables.
-- Antes: N000001, N000002... (secuenciales). Una nota de credito es plata "al portador": quien tenga el codigo la puede usar,
-- asi que un codigo adivinable permitiria a un empleado probar codigos hasta encontrar notas ajenas con saldo.
-- Ahora: N + 10 caracteres al azar (40 bits). Solo se ejecuta si todavia no hay notas emitidas.
do $$
begin
  if (select count(*) from notas_credito) > 0 then
    raise exception 'Ya hay notas de credito emitidas: no se cambia el formato del codigo con datos existentes.';
  end if;
end;
$$;

alter table notas_credito drop column codigo;
alter table notas_credito add column codigo text not null unique
  default ('N' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)));

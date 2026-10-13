-- Endurecimento de privilégios de tabela dos papéis anon e authenticated (aprovado separadamente da P1-02).
--
-- Por padrão do Supabase, anon e authenticated recebem TODOS os privilégios de tabela. O app só usa
-- SELECT, INSERT, UPDATE e DELETE (e quem governa o acesso a linhas é a RLS). Três privilégios não são
-- usados por nenhuma funcionalidade e, diferentemente dos demais, não passam pela RLS nem pelos triggers
-- de linha:
--   TRUNCATE    esvazia a tabela inteira;
--   TRIGGER     permite criar triggers na tabela;
--   REFERENCES  permite criar chaves estrangeiras que apontam para a tabela.
--
-- O que muda:
--   1. REVOKE desses três privilégios em todas as tabelas do schema public, para anon e authenticated.
--   2. Tabelas criadas no futuro pelo papel postgres (dono das migrations) nascem sem eles.
--
-- O que NÃO muda: SELECT/INSERT/UPDATE/DELETE de anon e authenticated (a migration confere a contagem antes
-- e depois e aborta se mudar), qualquer privilégio de service_role, postgres e demais papéis, e os schemas
-- storage/auth/graphql (gerenciados pela plataforma).
--
-- Idempotente. Reversão: grant truncate, references, trigger on table <tabelas> to anon, authenticated;
-- e o mesmo para alter default privileges (as tabelas e a ordem exatas ficam no plano de rollback).

do $$
declare
  v_before bigint;
  v_after bigint;
  v_left bigint;
  v_service_before bigint;
  v_service_after bigint;
begin
  -- contagem de privilégios que precisam sobreviver (SELECT/INSERT/UPDATE/DELETE de anon e authenticated)
  -- e de tudo que service_role tem
  select count(*) into v_before
  from pg_class c
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  join pg_roles r on r.oid = a.grantee and r.rolname in ('anon', 'authenticated')
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
    and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');

  select count(*) into v_service_before
  from pg_class c
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  join pg_roles r on r.oid = a.grantee and r.rolname = 'service_role'
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p');

  revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

  -- tabelas futuras criadas por postgres (o papel que roda as migrations)
  alter default privileges for role postgres in schema public
    revoke truncate, references, trigger on tables from anon, authenticated;

  select count(*) into v_after
  from pg_class c
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  join pg_roles r on r.oid = a.grantee and r.rolname in ('anon', 'authenticated')
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
    and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');

  select count(*) into v_service_after
  from pg_class c
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  join pg_roles r on r.oid = a.grantee and r.rolname = 'service_role'
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p');

  if v_before <> v_after then
    raise exception 'hardening: privilegios de DML de anon/authenticated mudaram (% -> %)', v_before, v_after;
  end if;
  if v_service_before <> v_service_after then
    raise exception 'hardening: privilegios de service_role mudaram (% -> %)', v_service_before, v_service_after;
  end if;

  -- nada pode restar para anon, authenticated ou PUBLIC (tabela ou coluna)
  select count(*) into v_left
  from pg_class c
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  left join pg_roles r on r.oid = a.grantee
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
    and a.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')
    and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'));
  if v_left <> 0 then
    raise exception 'hardening: restaram % privilegios TRUNCATE/TRIGGER/REFERENCES em tabelas de public', v_left;
  end if;

  select count(*) into v_left
  from pg_attribute at
  join pg_class c on c.oid = at.attrelid and c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
  cross join lateral aclexplode(at.attacl) a
  left join pg_roles r on r.oid = a.grantee
  where at.attacl is not null and not at.attisdropped
    and a.privilege_type = 'REFERENCES'
    and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'));
  if v_left <> 0 then
    raise exception 'hardening: restaram % privilegios REFERENCES em colunas de public', v_left;
  end if;
end $$;

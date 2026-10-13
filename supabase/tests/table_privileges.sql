-- MenuNext — teste de privilégios de tabela dos papéis anon e authenticated.
--
-- Cobre a migration 20261009030000_harden_table_privileges.sql. Tudo roda numa transação que SEMPRE termina
-- com `raise exception`; a criação de tabela de teste é desfeita. Como ler: a mensagem final é o relatório.
--   RESULTADO: OK | N verificacoes
--   RESULTADO: FALHOU (k) | N verificacoes | ...
--
-- Garante que:
--   * anon, authenticated e PUBLIC não têm TRUNCATE, TRIGGER nem REFERENCES em nenhuma tabela de public
--     (tabela ou coluna), e que tabelas futuras criadas por quem roda as migrations já nascem sem eles;
--   * o que o app usa continua concedido (SELECT/INSERT/UPDATE/DELETE do jeito que estava, inclusive o
--     UPDATE por coluna de restaurants e profiles e a ausência total de acesso a trial_extensions);
--   * service_role mantém tudo;
--   * authenticated e anon realmente recebem "permission denied" ao tentar TRUNCATE.

do $$
declare
  fails text[] := '{}'; notes text[] := '{}'; total int := 0;
  n bigint; t record; p text; col record; err text;
  dangerous text[] := array['TRUNCATE', 'TRIGGER', 'REFERENCES'];
begin
  -- 1. nenhuma tabela de public concede os três privilégios a anon, authenticated ou PUBLIC
  for t in
    select c.relname from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') order by 1
  loop
    foreach p in array dangerous loop
      total := total + 1;
      if has_table_privilege('anon', format('public.%I', t.relname), p) then
        fails := fails || format('anon tem %s em public.%s', p, t.relname);
      end if;
      if has_table_privilege('authenticated', format('public.%I', t.relname), p) then
        fails := fails || format('authenticated tem %s em public.%s', p, t.relname);
      end if;
    end loop;
  end loop;

  -- 2. PUBLIC (grantee 0) não tem nenhum privilégio de tabela em public
  total := total + 1;
  select count(*) into n
  from pg_class c cross join lateral aclexplode(c.relacl) a
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and a.grantee = 0;
  if n <> 0 then fails := fails || format('PUBLIC tem %s privilegios de tabela em public', n); end if;

  -- 3. nenhuma coluna concede REFERENCES a anon/authenticated/PUBLIC
  total := total + 1;
  select count(*) into n
  from pg_attribute at
  join pg_class c on c.oid = at.attrelid and c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
  cross join lateral aclexplode(at.attacl) a
  left join pg_roles r on r.oid = a.grantee
  where at.attacl is not null and not at.attisdropped and a.privilege_type = 'REFERENCES'
    and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'));
  if n <> 0 then fails := fails || format('%s colunas concedem REFERENCES', n); end if;

  -- 4. privilegios padrao de tabelas futuras (papel que roda as migrations) em public
  total := total + 1;
  select count(*) into n
  from pg_default_acl d
  join pg_namespace s on s.oid = d.defaclnamespace and s.nspname = 'public'
  cross join lateral aclexplode(d.defaclacl) a
  left join pg_roles r on r.oid = a.grantee
  where d.defaclobjtype = 'r' and d.defaclrole = (select oid from pg_roles where rolname = current_user)
    and a.privilege_type = any(dangerous) and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'));
  if n <> 0 then fails := fails || format('privilegios padrao do papel %s ainda concedem %s itens a anon/authenticated', current_user, n); end if;

  -- 5. tabela criada agora (como quem roda as migrations) nasce sem os privilegios
  create table public._priv_probe (id int);
  total := total + 4;
  foreach p in array dangerous loop
    if has_table_privilege('anon', 'public._priv_probe', p) or has_table_privilege('authenticated', 'public._priv_probe', p) then
      fails := fails || format('tabela nova nasce com %s para anon/authenticated', p);
    end if;
  end loop;
  if not (has_table_privilege('authenticated', 'public._priv_probe', 'SELECT')
          and has_table_privilege('authenticated', 'public._priv_probe', 'INSERT')
          and has_table_privilege('authenticated', 'public._priv_probe', 'UPDATE')
          and has_table_privilege('authenticated', 'public._priv_probe', 'DELETE')) then
    fails := fails || 'tabela nova nasce SEM SELECT/INSERT/UPDATE/DELETE para authenticated (privilegio de DML foi cortado)'::text;
  end if;
  drop table public._priv_probe;

  -- 6. service_role mantem tudo (backend: webhook, reconciliacao, jobs)
  for t in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') loop
    total := total + 1;
    if not (has_table_privilege('service_role', format('public.%I', t.relname), 'SELECT')
            and has_table_privilege('service_role', format('public.%I', t.relname), 'INSERT')
            and has_table_privilege('service_role', format('public.%I', t.relname), 'UPDATE')
            and has_table_privilege('service_role', format('public.%I', t.relname), 'DELETE')
            and has_table_privilege('service_role', format('public.%I', t.relname), 'TRUNCATE')) then
      fails := fails || format('service_role perdeu privilegio em public.%s', t.relname);
    end if;
  end loop;

  -- 7. o que o app usa continua concedido
  total := total + 1;
  if not (has_table_privilege('anon', 'public.products', 'SELECT') and has_table_privilege('anon', 'public.restaurants', 'SELECT')
          and has_table_privilege('anon', 'public.business_hours', 'SELECT')) then
    fails := fails || 'anon perdeu SELECT (vitrine publica depende das politicas de SELECT)'::text;
  end if;
  total := total + 1;
  if not (has_table_privilege('authenticated', 'public.products', 'SELECT') and has_table_privilege('authenticated', 'public.products', 'INSERT')
          and has_table_privilege('authenticated', 'public.products', 'UPDATE') and has_table_privilege('authenticated', 'public.products', 'DELETE')
          and has_table_privilege('authenticated', 'public.orders', 'SELECT') and has_table_privilege('authenticated', 'public.coupons', 'DELETE')) then
    fails := fails || 'authenticated perdeu SELECT/INSERT/UPDATE/DELETE em tabelas do app'::text;
  end if;
  total := total + 1;
  if not (has_column_privilege('authenticated', 'public.restaurants', 'name', 'UPDATE')
          and has_column_privilege('authenticated', 'public.restaurants', 'payment_pix_key', 'UPDATE')
          and has_column_privilege('authenticated', 'public.profiles', 'name', 'UPDATE')) then
    fails := fails || 'authenticated perdeu o UPDATE por coluna de restaurants/profiles'::text;
  end if;
  total := total + 1;
  if has_table_privilege('authenticated', 'public.restaurants', 'UPDATE') or has_column_privilege('authenticated', 'public.restaurants', 'plan_id', 'UPDATE') then
    fails := fails || 'authenticated ganhou UPDATE de tabela/colunas de cobranca em restaurants'::text;
  end if;
  total := total + 1;
  if exists (select 1 from pg_class c where c.relname = 'trial_extensions' and c.relnamespace = 'public'::regnamespace)
     and (has_table_privilege('authenticated', 'public.trial_extensions', 'SELECT') or has_table_privilege('anon', 'public.trial_extensions', 'SELECT')) then
    fails := fails || 'trial_extensions deveria seguir sem acesso para anon/authenticated'::text;
  end if;

  -- 8. na pratica: TRUNCATE e negado
  foreach p in array array['authenticated', 'anon'] loop
    total := total + 1;
    begin
      execute format('set local role %I', p);
      execute 'truncate public.categories';
      fails := fails || format('%s executou TRUNCATE em public.categories', p);
    exception when others then
      err := sqlerrm;
      if err not like '%permission denied%' then
        fails := fails || format('%s: TRUNCATE falhou por outro motivo (inconclusivo): %s', p, err);
      end if;
    end;
    reset role;
  end loop;

  -- notas (informativas, nao falham): privilegios padrao de outros papeis que criam tabelas em public
  select count(*) into n
  from pg_default_acl d
  join pg_namespace s on s.oid = d.defaclnamespace and s.nspname = 'public'
  cross join lateral aclexplode(d.defaclacl) a
  left join pg_roles r on r.oid = a.grantee
  where d.defaclobjtype = 'r' and d.defaclrole <> (select oid from pg_roles where rolname = current_user)
    and a.privilege_type = any(dangerous) and r.rolname in ('anon', 'authenticated');
  if n > 0 then
    notes := notes || format('%s privilegios padrao de OUTROS papeis (ex.: administrador da plataforma) ainda valem para tabelas que eles criarem em public; este teste as detecta', n);
  end if;

  if array_length(fails, 1) is null then
    raise exception 'RESULTADO: OK | % verificacoes | notas: %', total, coalesce(array_to_string(notes, ' ; '), '-');
  else
    raise exception 'RESULTADO: FALHOU (%) | % verificacoes | %  || notas: %', array_length(fails, 1), total,
      array_to_string(fails, ' ## '), coalesce(array_to_string(notes, ' ; '), '-');
  end if;
end $$;

-- MenuNext — teste de regressão: segundo fator (AAL2) exigido pelo BANCO para o administrador da plataforma.
--
-- ATENÇÃO — RODE SÓ EM BANCO ISOLADO. Tudo num bloco que SEMPRE termina com `raise exception` (nada persiste).
-- Resultado: a mensagem final do erro ("RESULTADO: OK | N verificacoes" ou "FALHOU").
--
-- O que prova: com a exigência DESLIGADA nada muda; só um administrador em AAL2 liga; ligada, um JWT de administrador
-- em AAL1 (ou sem claim `aal`, ou com valor estranho) NÃO é mais administrador em nenhuma função nem política que use
-- is_platform_admin() — chamadas diretas às RPCs do Master incluídas; AAL2 volta a funcionar; não-administrador
-- nunca vira administrador, em nenhum nível; a tabela é inacessível ao usuário; a recuperação por dono do banco funciona.

create or replace function pg_temp._runas(p_role text, p_uid uuid, p_aal text, p_stmt text) returns text
language plpgsql as $$
declare v_res text;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then ''
         else json_build_object('sub', p_uid, 'role', 'authenticated') ::jsonb::text end, true);
  if p_uid is not null and p_aal is not null then
    perform set_config('request.jwt.claims',
      (json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal))::text, true);
  end if;
  execute format('set local role %I', p_role);
  begin
    execute p_stmt into v_res;
  exception when others then
    v_res := 'ERR: ' || sqlerrm;
  end;
  execute 'reset role';
  return v_res;
end $$;

do $$
declare
  u_admin uuid := gen_random_uuid();
  u_user uuid := gen_random_uuid();
  u_owner uuid := gen_random_uuid();
  r_a uuid;
  res text;
  fails text[] := '{}'; total int := 0;
  a text;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (u_admin, 'admin@mfa.test', jsonb_build_object('name','Plataforma','phone','11999990001','document','12345678062')),
    (u_user,  'user@mfa.test',  jsonb_build_object('name','Usuario','phone','11999990002','document','98765432029')),
    (u_owner, 'owner@mfa.test', jsonb_build_object('name','Dono','phone','11999990003','document','24681357090'));
  update public.profiles set is_master = true where user_id = u_admin;
  update public.profiles set trial_ends_at = now() + interval '30 days' where user_id = u_owner;
  insert into public.restaurants (name, slug) values ('Loja A', 'mfa-a') returning id into r_a;
  insert into public.restaurant_members (restaurant_id, user_id, role) values (r_a, u_owner, 'OWNER');

  -- ---------- 0) catálogo ----------
  total := total + 1;
  if not exists (select 1 from pg_class where oid = 'public.platform_security'::regclass and relrowsecurity) then fails := fails || 'platform_security sem RLS'::text; end if;
  total := total + 1;
  if has_table_privilege('anon','public.platform_security','SELECT') or has_table_privilege('authenticated','public.platform_security','SELECT')
     or has_table_privilege('authenticated','public.platform_security','UPDATE') or has_table_privilege('authenticated','public.platform_security','INSERT')
     or has_table_privilege('authenticated','public.platform_security','DELETE') then
    fails := fails || 'platform_security acessivel a anon/authenticated'::text;
  end if;
  total := total + 1;
  if has_function_privilege('anon','public.platform_admin_state()','EXECUTE') or has_function_privilege('anon','public.platform_set_require_aal2(boolean)','EXECUTE')
     or has_function_privilege('anon','public.is_platform_admin()','EXECUTE') or has_function_privilege('anon','public.platform_get_require_aal2()','EXECUTE')
     or has_function_privilege('authenticated','public._platform_aal2_ok()','EXECUTE')
     or not has_function_privilege('authenticated','public.is_platform_admin()','EXECUTE')
     or not has_function_privilege('authenticated','public.platform_admin_state()','EXECUTE') then
    fails := fails || 'privilegios de EXECUTE incorretos'::text;
  end if;
  total := total + 1;
  if (select count(*) from public.platform_security) <> 1 or (select require_aal2 from public.platform_security) then fails := fails || 'deveria nascer desligada (1 linha)'::text; end if;
  begin
    insert into public.platform_security (id) values (false);
    fails := fails || 'singleton nao impediu segunda linha'::text;
  exception when others then null; end;
  total := total + 1;

  -- ---------- 1) DESLIGADA: comportamento anterior ----------
  res := pg_temp._runas('authenticated', u_admin, 'aal1', 'select public.is_platform_admin()::text');
  total := total + 1;
  if res <> 'true' then fails := fails || format('desligada: admin em aal1 deveria continuar admin (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_admin, null, 'select public.is_platform_admin()::text');
  total := total + 1;
  if res <> 'true' then fails := fails || format('desligada: admin sem claim aal deveria continuar admin (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_admin, 'aal1', 'select (public.master_dashboard_stats())::text');
  total := total + 1;
  if res like 'ERR:%' then fails := fails || format('desligada: master_dashboard_stats em aal1 deveria funcionar (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_user, 'aal2', 'select public.is_platform_admin()::text');
  total := total + 1;
  if res <> 'false' then fails := fails || format('nao administrador nunca e admin, nem em aal2 (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_admin, 'aal1', 'select public.platform_admin_state()');
  total := total + 1;
  if res <> 'admin' then fails := fails || format('desligada: estado deveria ser admin (%s)', res); end if;

  -- ---------- 2) quem liga ----------
  res := pg_temp._runas('authenticated', u_admin, 'aal1', 'select public.platform_set_require_aal2(true)::text');
  total := total + 1;
  if res not ilike '%aal2_required%' then fails := fails || format('admin em aal1 NAO pode ligar (anti-trancamento) (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_admin, null, 'select public.platform_set_require_aal2(true)::text');
  total := total + 1;
  if res not ilike '%aal2_required%' then fails := fails || format('admin sem claim aal NAO pode ligar (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_user, 'aal2', 'select public.platform_set_require_aal2(true)::text');
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('nao admin em aal2 NAO liga (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner, 'aal2', 'select public.platform_set_require_aal2(true)::text');
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('dono de loja NAO liga (%s)', res); end if;
  res := pg_temp._runas('anon', null, null, 'select public.platform_set_require_aal2(true)::text');
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('visitante NAO liga (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_admin, 'aal2', 'select public.platform_set_require_aal2(null)::text');
  total := total + 1;
  if res not ilike '%invalid_value%' then fails := fails || format('valor nulo (%s)', res); end if;
  total := total + 1;
  if (select require_aal2 from public.platform_security) then fails := fails || 'tentativas nao autorizadas ligaram a exigencia'::text; end if;

  res := pg_temp._runas('authenticated', u_admin, 'aal2', 'select public.platform_set_require_aal2(true)::text');
  total := total + 1;
  if res <> 'true' or not (select require_aal2 from public.platform_security) or (select updated_by from public.platform_security) is distinct from u_admin then
    fails := fails || format('admin em aal2 deveria ligar e registrar o autor (%s)', res);
  end if;

  -- ---------- 3) LIGADA: AAL1 deixa de ser administrador em tudo ----------
  foreach a in array array['aal1', 'aal0', 'AAL2', 'aal3', ''] loop
    res := pg_temp._runas('authenticated', u_admin, a, 'select public.is_platform_admin()::text');
    total := total + 1;
    if res <> 'false' then fails := fails || format('ligada: aal=%L nao deveria ser admin (%s)', a, res); end if;
  end loop;
  res := pg_temp._runas('authenticated', u_admin, null, 'select public.is_platform_admin()::text');
  total := total + 1;
  if res <> 'false' then fails := fails || format('ligada: JWT sem claim aal nao deveria ser admin (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_admin, 'aal2', 'select public.is_platform_admin()::text');
  total := total + 1;
  if res <> 'true' then fails := fails || format('ligada: aal2 deveria ser admin (%s)', res); end if;

  -- chamadas DIRETAS às RPCs administrativas (o contorno que esta migration fecha)
  res := pg_temp._runas('authenticated', u_admin, 'aal1', 'select (public.master_dashboard_stats())::text');
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('ligada: master_dashboard_stats em aal1 deveria ser negada (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_admin, 'aal1', 'select count(*)::text from public.master_list_restaurants()');
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('ligada: master_list_restaurants em aal1 deveria ser negada (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_admin, 'aal1', 'select count(*)::text from public.master_metrics(30)');
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('ligada: master_metrics em aal1 deveria ser negada (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_admin, 'aal1', format('select public.master_extend_trial(%L, 5)::text', r_a));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('ligada: master_extend_trial em aal1 deveria ser negada (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_admin, 'aal1', $s$select public.update_platform_settings('x@exemplo.com', null)::text$s$);
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('ligada: update_platform_settings em aal1 deveria ser negada (%s)', res); end if;

  res := pg_temp._runas('authenticated', u_admin, 'aal2', 'select (public.master_dashboard_stats())::text');
  total := total + 1;
  if res like 'ERR:%' then fails := fails || format('ligada: master_dashboard_stats em aal2 deveria funcionar (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_admin, 'aal2', 'select count(*)::text from public.master_list_restaurants()');
  total := total + 1;
  if res like 'ERR:%' or res::int < 1 then fails := fails || format('ligada: master_list_restaurants em aal2 deveria listar (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_admin, 'aal2', $s$select public.update_platform_settings('suporte@exemplo.com', null)::text$s$);
  total := total + 1;
  if res like 'ERR:%' then fails := fails || format('ligada: update_platform_settings em aal2 deveria funcionar (%s)', res); end if;

  -- estado para o app encaminhar ao segundo fator
  res := pg_temp._runas('authenticated', u_admin, 'aal1', 'select public.platform_admin_state()');
  total := total + 1;
  if res <> 'mfa_required' then fails := fails || format('ligada: admin em aal1 deveria estar em mfa_required (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_admin, 'aal2', 'select public.platform_admin_state()');
  total := total + 1;
  if res <> 'admin' then fails := fails || format('ligada: admin em aal2 deveria estar em admin (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_user, 'aal2', 'select public.platform_admin_state()');
  total := total + 1;
  if res <> 'not_admin' then fails := fails || format('nao admin deveria estar em not_admin (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_user, 'aal1', 'select public.is_platform_admin()::text');
  total := total + 1;
  if res <> 'false' then fails := fails || format('ligada: nao admin continua nao admin (%s)', res); end if;
  res := pg_temp._runas('anon', null, null, 'select public.platform_admin_state()');
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('visitante nao consulta o estado (%s)', res); end if;

  -- a tabela continua fechada, inclusive para o administrador em aal2
  res := pg_temp._runas('authenticated', u_admin, 'aal2', 'select require_aal2::text from public.platform_security');
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('admin leu a tabela direto (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_admin, 'aal2', 'update public.platform_security set require_aal2 = false returning 1');
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('admin alterou a tabela direto (%s)', res); end if;

  -- admin em aal1 nao desliga, nem ve o estado
  res := pg_temp._runas('authenticated', u_admin, 'aal1', 'select public.platform_set_require_aal2(false)::text');
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('ligada: admin em aal1 nao pode desligar (%s)', res); end if;
  total := total + 1;
  if not (select require_aal2 from public.platform_security) then fails := fails || 'tentativa em aal1 desligou a exigencia'::text; end if;

  -- o dono de loja e o resto do sistema nao sao afetados
  res := pg_temp._runas('authenticated', u_owner, 'aal1', 'select count(*)::text from public.restaurants');
  total := total + 1;
  if res <> '1' then fails := fails || format('dono de loja em aal1 continua lendo a propria loja (%s)', res); end if;

  -- leitura do estado: só administrador (em aal2 quando ligada)
  res := pg_temp._runas('authenticated', u_admin, 'aal2', 'select public.platform_get_require_aal2()::text');
  total := total + 1;
  if res <> 'true' then fails := fails || format('admin em aal2 deveria ler o estado ligado (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_admin, 'aal1', 'select public.platform_get_require_aal2()::text');
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('ligada: admin em aal1 nao le o estado (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_user, 'aal2', 'select public.platform_get_require_aal2()::text');
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('nao admin nao le o estado (%s)', res); end if;
  res := pg_temp._runas('anon', null, null, 'select public.platform_get_require_aal2()::text');
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('visitante nao le o estado (%s)', res); end if;

  -- ---------- 4) recuperação por dono do banco e desligamento por admin em aal2 ----------
  update public.platform_security set require_aal2 = false;
  res := pg_temp._runas('authenticated', u_admin, 'aal1', 'select public.is_platform_admin()::text');
  total := total + 1;
  if res <> 'true' then fails := fails || format('recuperacao por SQL deveria restaurar o acesso em aal1 (%s)', res); end if;
  perform pg_temp._runas('authenticated', u_admin, 'aal2', 'select public.platform_set_require_aal2(true)::text');
  res := pg_temp._runas('authenticated', u_admin, 'aal2', 'select public.platform_set_require_aal2(false)::text');
  total := total + 1;
  if res <> 'false' or (select require_aal2 from public.platform_security) then fails := fails || format('admin em aal2 deveria desligar (%s)', res); end if;

  if array_length(fails, 1) is null then
    raise exception 'RESULTADO: OK | % verificacoes', total;
  else
    raise exception 'RESULTADO: FALHOU (%) | % verificacoes | %', array_length(fails, 1), total, array_to_string(fails, ' ## ');
  end if;
end $$;

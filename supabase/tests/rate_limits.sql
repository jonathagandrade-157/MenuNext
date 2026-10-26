-- MenuNext — teste de regressão: limite de tentativas (rate_limits / rate_limit_hit).
--
-- ATENÇÃO — RODE SÓ EM BANCO ISOLADO (local ou branch). Tudo fica numa transação que SEMPRE termina com
-- `raise exception` (nada persiste).
-- Resultado: a mensagem final do erro é o relatório ("RESULTADO: OK | N verificacoes" ou "FALHOU").
--
-- Regras testadas: tabela e função fechadas para visitante e usuário logado (só o backend conta); contagem
-- dentro do limite, bloqueio acima dele, baldes independentes, retry_after coerente, limites inválidos
-- recusados, limpeza de janelas velhas do próprio balde.

do $$
declare
  u uuid := gen_random_uuid();
  r record; err text; n bigint;
  fails text[] := '{}'; total int := 0;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (u, 'u@rl.test', jsonb_build_object('name','U','phone','11999990001','document','12345678062'));

  -- catálogo e privilégios
  total := total + 1;
  if not exists (select 1 from pg_class where oid = 'public.rate_limits'::regclass and relrowsecurity) then
    fails := fails || 'rate_limits sem RLS'::text;
  end if;
  total := total + 1;
  if has_table_privilege('anon','public.rate_limits','SELECT') or has_table_privilege('authenticated','public.rate_limits','SELECT')
     or has_table_privilege('authenticated','public.rate_limits','INSERT') or has_table_privilege('authenticated','public.rate_limits','UPDATE')
     or has_table_privilege('authenticated','public.rate_limits','DELETE') then
    fails := fails || 'rate_limits aberta para anon/authenticated'::text;
  end if;
  total := total + 1;
  if has_function_privilege('anon','public.rate_limit_hit(text,integer,integer)','EXECUTE')
     or has_function_privilege('authenticated','public.rate_limit_hit(text,integer,integer)','EXECUTE') then
    fails := fails || 'rate_limit_hit executavel por anon/authenticated'::text;
  end if;
  total := total + 1;
  if not has_function_privilege('service_role','public.rate_limit_hit(text,integer,integer)','EXECUTE') then
    fails := fails || 'service_role nao executa rate_limit_hit'::text;
  end if;

  -- visitante e usuário logado são recusados
  set local role anon;
  begin perform * from public.rate_limit_hit('x', 5, 60); err := 'ok'; exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%permission denied%' then fails := fails || format('anon executou (%s)', err); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform * from public.rate_limit_hit('x', 5, 60); err := 'ok'; exception when others then err := sqlerrm; end;
  reset role;
  total := total + 1;
  if err not ilike '%permission denied%' then fails := fails || format('authenticated executou (%s)', err); end if;

  -- backend: contagem e bloqueio (limite 3)
  set local role service_role;
  select * into r from public.rate_limit_hit('login:ip:1.1.1.1', 3, 60);
  total := total + 1;
  if r.is_allowed is not true or r.hit_count <> 1 then fails := fails || format('1a tentativa: allowed=%s hits=%s', r.is_allowed, r.hit_count); end if;
  select * into r from public.rate_limit_hit('login:ip:1.1.1.1', 3, 60);
  select * into r from public.rate_limit_hit('login:ip:1.1.1.1', 3, 60);
  total := total + 1;
  if r.is_allowed is not true or r.hit_count <> 3 then fails := fails || format('3a tentativa deveria ser a ultima permitida: allowed=%s hits=%s', r.is_allowed, r.hit_count); end if;
  select * into r from public.rate_limit_hit('login:ip:1.1.1.1', 3, 60);
  total := total + 1;
  if r.is_allowed is not false or r.hit_count <> 4 then fails := fails || format('4a tentativa deveria ser bloqueada: allowed=%s hits=%s', r.is_allowed, r.hit_count); end if;
  total := total + 1;
  if r.retry_after not between 1 and 60 then fails := fails || format('retry_after fora de 1..60 (%s)', r.retry_after); end if;
  select * into r from public.rate_limit_hit('login:ip:1.1.1.1', 3, 60);
  total := total + 1;
  if r.is_allowed is not false then fails := fails || 'depois de bloqueado continua bloqueado na mesma janela'::text; end if;

  -- balde diferente é independente
  select * into r from public.rate_limit_hit('login:ip:2.2.2.2', 3, 60);
  total := total + 1;
  if r.is_allowed is not true or r.hit_count <> 1 then fails := fails || 'baldes nao sao independentes'::text; end if;
  select * into r from public.rate_limit_hit('checkout:ip:1.1.1.1', 3, 60);
  total := total + 1;
  if r.is_allowed is not true or r.hit_count <> 1 then fails := fails || 'escopos diferentes do mesmo IP nao sao independentes'::text; end if;

  -- argumentos inválidos
  begin perform * from public.rate_limit_hit('', 3, 60); err := 'ok'; exception when others then err := sqlerrm; end;
  total := total + 1;
  if err not ilike '%invalid_rate_limit_args%' then fails := fails || format('balde vazio aceito (%s)', err); end if;
  begin perform * from public.rate_limit_hit('a', 0, 60); err := 'ok'; exception when others then err := sqlerrm; end;
  total := total + 1;
  if err not ilike '%invalid_rate_limit_args%' then fails := fails || format('limite 0 aceito (%s)', err); end if;
  begin perform * from public.rate_limit_hit('a', 5, 0); err := 'ok'; exception when others then err := sqlerrm; end;
  total := total + 1;
  if err not ilike '%invalid_rate_limit_args%' then fails := fails || format('janela 0 aceita (%s)', err); end if;
  begin perform * from public.rate_limit_hit(repeat('x', 201), 5, 60); err := 'ok'; exception when others then err := sqlerrm; end;
  total := total + 1;
  if err not ilike '%invalid_rate_limit_args%' then fails := fails || format('balde gigante aceito (%s)', err); end if;
  begin perform * from public.rate_limit_hit(null, 5, 60); err := 'ok'; exception when others then err := sqlerrm; end;
  total := total + 1;
  if err not ilike '%invalid_rate_limit_args%' then fails := fails || format('balde nulo aceito (%s)', err); end if;
  reset role;

  -- limpeza: janela de 2 dias atrás do MESMO balde some na próxima tentativa; a de outro balde fica
  insert into public.rate_limits (bucket, window_start, hits) values
    ('limpeza:a', now() - interval '2 days', 9), ('limpeza:b', now() - interval '2 days', 9);
  set local role service_role;
  perform * from public.rate_limit_hit('limpeza:a', 5, 60);
  reset role;
  total := total + 1;
  select count(*) into n from public.rate_limits where bucket = 'limpeza:a' and window_start < now() - interval '1 day';
  if n <> 0 then fails := fails || 'janela velha do proprio balde nao foi limpa'::text; end if;

  if array_length(fails, 1) is null then
    raise exception 'RESULTADO: OK | % verificacoes', total;
  else
    raise exception 'RESULTADO: FALHOU (%) | % verificacoes | %', array_length(fails, 1), total, array_to_string(fails, ' ## ');
  end if;
end $$;

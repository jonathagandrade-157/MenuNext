-- MenuNext — teste de regressão: suporte (chamados e mensagens).
--
-- ATENÇÃO — RODE SÓ EM BANCO ISOLADO. Tudo acontece num bloco que SEMPRE termina com `raise exception`
-- (nada persiste). Resultado: a mensagem final do erro ("RESULTADO: OK | N verificacoes" ou "FALHOU").
--
-- Regras testadas: só o OWNER abre chamado e só da própria loja; STAFF e estranho não; loja B nunca vê nem responde
-- chamado da loja A; admin da plataforma vê tudo, responde, muda status/prioridade; lojista só encerra o próprio
-- chamado e não define prioridade; transições de status por mensagem; chamado encerrado não recebe resposta;
-- limites (10 abertos, 20 mensagens/hora); tabelas sem escrita direta; mensagens append-only.

create or replace function pg_temp._runas(p_role text, p_uid uuid, p_stmt text) returns text
language plpgsql as $$
declare v_res text;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
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
  u_owner_a uuid := gen_random_uuid();
  u_staff_a uuid := gen_random_uuid();
  u_owner_b uuid := gen_random_uuid();
  u_stranger uuid := gen_random_uuid();
  u_admin uuid := gen_random_uuid();
  r_a uuid; r_b uuid; tk uuid; tkb uuid; i int;
  res text;
  fails text[] := '{}'; total int := 0;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (u_owner_a, 'owner-a@sp.test', jsonb_build_object('name','Dona A','phone','11999990001','document','12345678062')),
    (u_staff_a, 'staff-a@sp.test', jsonb_build_object('name','Equipe A','phone','11999990002','document','98765432029')),
    (u_owner_b, 'owner-b@sp.test', jsonb_build_object('name','Dono B','phone','11999990003','document','24681357090')),
    (u_stranger,'stranger@sp.test',jsonb_build_object('name','Estranho','phone','11999990005','document','86420975310')),
    (u_admin,   'admin@sp.test',   jsonb_build_object('name','Plataforma','phone','11999990006','document','39053344705'));
  update public.profiles set is_master = true where user_id = u_admin;
  update public.profiles set trial_ends_at = now() + interval '30 days' where user_id in (u_owner_a, u_owner_b);
  insert into public.restaurants (name, slug) values ('Loja A', 'sp-a') returning id into r_a;
  insert into public.restaurants (name, slug) values ('Loja B', 'sp-b') returning id into r_b;
  insert into public.restaurant_members (restaurant_id, user_id, role) values
    (r_a, u_owner_a, 'OWNER'), (r_a, u_staff_a, 'STAFF'), (r_b, u_owner_b, 'OWNER');

  -- ---------- 0) catálogo ----------
  total := total + 1;
  if not exists (select 1 from pg_class where oid = 'public.support_tickets'::regclass and relrowsecurity)
     or not exists (select 1 from pg_class where oid = 'public.support_messages'::regclass and relrowsecurity) then
    fails := fails || 'tabelas de suporte sem RLS'::text;
  end if;
  total := total + 1;
  if has_table_privilege('anon','public.support_tickets','SELECT') or has_table_privilege('anon','public.support_messages','SELECT')
     or has_table_privilege('authenticated','public.support_tickets','INSERT') or has_table_privilege('authenticated','public.support_tickets','UPDATE')
     or has_table_privilege('authenticated','public.support_tickets','DELETE')
     or has_table_privilege('authenticated','public.support_messages','INSERT') or has_table_privilege('authenticated','public.support_messages','UPDATE')
     or has_table_privilege('authenticated','public.support_messages','DELETE')
     or not has_table_privilege('authenticated','public.support_tickets','SELECT') then
    fails := fails || 'privilegios de tabela incorretos'::text;
  end if;
  total := total + 1;
  if has_function_privilege('anon','public.support_create_ticket(text,text,text)','EXECUTE')
     or has_function_privilege('anon','public.support_admin_list(text,integer)','EXECUTE')
     or not has_function_privilege('authenticated','public.support_add_message(uuid,text)','EXECUTE') then
    fails := fails || 'privilegios de EXECUTE incorretos'::text;
  end if;

  -- ---------- 1) quem abre ----------
  res := pg_temp._runas('authenticated', u_owner_a, $s$select public.support_create_ticket('Pix não aparece', 'O Pix não aparece no checkout', 'high')::text$s$);
  total := total + 1;
  if res like 'ERR:%' then fails := fails || format('OWNER nao abriu chamado (%s)', res); else tk := res::uuid; end if;
  total := total + 1;
  if (select count(*) from public.support_messages where ticket_id = tk and author_kind = 'merchant') <> 1
     or (select priority from public.support_tickets where id = tk) <> 'high'
     or (select status from public.support_tickets where id = tk) <> 'open' then
    fails := fails || 'chamado deveria nascer open/high com a primeira mensagem'::text;
  end if;
  res := pg_temp._runas('authenticated', u_staff_a, $s$select public.support_create_ticket('Assunto', 'texto', 'normal')::text$s$);
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('STAFF abriu chamado (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_stranger, $s$select public.support_create_ticket('Assunto', 'texto', 'normal')::text$s$);
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('estranho abriu chamado (%s)', res); end if;
  res := pg_temp._runas('anon', null, $s$select public.support_create_ticket('Assunto', 'texto', 'normal')::text$s$);
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('visitante abriu chamado (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, $s$select public.support_create_ticket('Assunto', 'texto', 'urgent')::text$s$);
  total := total + 1;
  if res not ilike '%invalid_priority%' then fails := fails || format('lojista definiu prioridade urgent (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, $s$select public.support_create_ticket('ab', 'texto', 'normal')::text$s$);
  total := total + 1;
  if res not ilike '%invalid_subject%' then fails := fails || format('assunto curto (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, $s$select public.support_create_ticket('Assunto ok', '   ', 'normal')::text$s$);
  total := total + 1;
  if res not ilike '%invalid_body%' then fails := fails || format('corpo vazio (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('select public.support_create_ticket(''Assunto ok'', %L, ''normal'')::text', repeat('x', 4001)));
  total := total + 1;
  if res not ilike '%invalid_body%' then fails := fails || format('corpo gigante (%s)', res); end if;

  -- ---------- 2) isolamento de leitura ----------
  res := pg_temp._runas('authenticated', u_owner_b, 'select count(*)::text from public.support_tickets');
  total := total + 1;
  if res <> '0' then fails := fails || format('OWNER B viu chamado da loja A (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_b, 'select count(*)::text from public.support_messages');
  total := total + 1;
  if res <> '0' then fails := fails || format('OWNER B viu mensagem da loja A (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_staff_a, 'select count(*)::text from public.support_tickets');
  total := total + 1;
  if res <> '0' then fails := fails || format('STAFF viu chamados (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_stranger, 'select count(*)::text from public.support_tickets');
  total := total + 1;
  if res <> '0' then fails := fails || format('estranho viu chamados (%s)', res); end if;
  res := pg_temp._runas('anon', null, 'select count(*)::text from public.support_tickets');
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('visitante leu chamados (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, 'select count(*)::text from public.support_tickets');
  total := total + 1;
  if res <> '1' then fails := fails || format('OWNER A deveria ver o proprio chamado (%s)', res); end if;

  -- ---------- 3) respostas ----------
  res := pg_temp._runas('authenticated', u_owner_b, format('select public.support_add_message(%L, ''invasao'')::text', tk));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('OWNER B respondeu chamado da loja A (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_staff_a, format('select public.support_add_message(%L, ''x'')::text', tk));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('STAFF respondeu (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('select public.support_add_message(%L, ''x'')::text', gen_random_uuid()));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('chamado inexistente (%s)', res); end if;

  res := pg_temp._runas('authenticated', u_admin, format('select public.support_add_message(%L, ''Vamos verificar'')::text', tk));
  total := total + 1;
  if res like 'ERR:%' then fails := fails || format('admin nao respondeu (%s)', res); end if;
  total := total + 1;
  if (select status from public.support_tickets where id = tk) <> 'waiting_customer'
     or not exists (select 1 from public.support_messages where ticket_id = tk and author_kind = 'platform' and author_id = u_admin) then
    fails := fails || 'resposta da plataforma deveria virar waiting_customer com autor platform'::text;
  end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('select public.support_add_message(%L, ''Segue o print'')::text', tk));
  total := total + 1;
  if res like 'ERR:%' then fails := fails || format('OWNER nao respondeu o proprio chamado (%s)', res); end if;
  total := total + 1;
  if (select status from public.support_tickets where id = tk) <> 'open'
     or not exists (select 1 from public.support_messages where ticket_id = tk and author_kind = 'merchant' and author_id = u_owner_a) then
    fails := fails || 'resposta do lojista deveria reabrir para a fila (open)'::text;
  end if;
  res := pg_temp._runas('authenticated', u_owner_a, 'select count(*)::text from public.support_messages');
  total := total + 1;
  if res <> '3' then fails := fails || format('OWNER A deveria ver as 3 mensagens (%s)', res); end if;

  -- ---------- 4) prioridade e status ----------
  res := pg_temp._runas('authenticated', u_owner_a, format('select public.support_set_priority(%L, ''urgent'')::text', tk));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('lojista alterou prioridade (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_admin, format('select public.support_set_priority(%L, ''urgent'')::text', tk));
  total := total + 1;
  if res like 'ERR:%' or (select priority from public.support_tickets where id = tk) <> 'urgent' then fails := fails || format('admin nao definiu prioridade (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_admin, format('select public.support_set_priority(%L, ''critica'')::text', tk));
  total := total + 1;
  if res not ilike '%invalid_priority%' then fails := fails || format('prioridade invalida (%s)', res); end if;

  res := pg_temp._runas('authenticated', u_owner_a, format('select public.support_set_status(%L, ''resolved'')::text', tk));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('lojista marcou resolved (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_b, format('select public.support_set_status(%L, ''closed'')::text', tk));
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('OWNER B encerrou chamado da loja A (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_admin, format('select public.support_set_status(%L, ''resolved'')::text', tk));
  total := total + 1;
  if res like 'ERR:%' or (select status from public.support_tickets where id = tk) <> 'resolved' then fails := fails || format('admin nao resolveu (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_admin, format('select public.support_set_status(%L, ''banana'')::text', tk));
  total := total + 1;
  if res not ilike '%invalid_status%' then fails := fails || format('status invalido (%s)', res); end if;

  res := pg_temp._runas('authenticated', u_owner_a, format('select public.support_set_status(%L, ''closed'')::text', tk));
  total := total + 1;
  if res like 'ERR:%' or (select status from public.support_tickets where id = tk) <> 'closed' or (select closed_at from public.support_tickets where id = tk) is null then
    fails := fails || format('lojista nao encerrou o proprio chamado (%s)', res);
  end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('select public.support_add_message(%L, ''mais uma'')::text', tk));
  total := total + 1;
  if res not ilike '%ticket_closed%' then fails := fails || format('chamado encerrado aceitou mensagem do lojista (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_admin, format('select public.support_add_message(%L, ''mais uma'')::text', tk));
  total := total + 1;
  if res not ilike '%ticket_closed%' then fails := fails || format('chamado encerrado aceitou mensagem da plataforma (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_admin, format('select public.support_set_status(%L, ''open'')::text', tk));
  total := total + 1;
  if res like 'ERR:%' or (select closed_at from public.support_tickets where id = tk) is not null then fails := fails || format('admin nao reabriu (%s)', res); end if;

  -- ---------- 5) fila da plataforma ----------
  res := pg_temp._runas('authenticated', u_owner_a, 'select count(*)::text from public.support_admin_list()');
  total := total + 1;
  if res not ilike '%not_authorized%' then fails := fails || format('lojista listou a fila da plataforma (%s)', res); end if;
  res := pg_temp._runas('anon', null, 'select count(*)::text from public.support_admin_list()');
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('visitante listou a fila (%s)', res); end if;

  res := pg_temp._runas('authenticated', u_owner_b, $s$select public.support_create_ticket('Dúvida da loja B', 'Como cadastro cupom?', 'low')::text$s$);
  tkb := res::uuid;
  res := pg_temp._runas('authenticated', u_admin, 'select count(*)::text from public.support_admin_list()');
  total := total + 1;
  if res <> '2' then fails := fails || format('admin deveria listar os 2 chamados (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_admin, 'select restaurant_name || '':'' || priority from public.support_admin_list() limit 1');
  total := total + 1;
  if res <> 'Loja A:urgent' then fails := fails || format('fila deveria priorizar urgent primeiro (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_admin, $s$select count(*)::text from public.support_admin_list('open')$s$);
  total := total + 1;
  if res <> '2' then fails := fails || format('filtro por status open (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_admin, 'select count(*)::text from public.support_tickets');
  total := total + 1;
  if res <> '2' then fails := fails || format('admin deveria ler as 2 linhas por RLS (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_b, 'select count(*)::text from public.support_tickets');
  total := total + 1;
  if res <> '1' then fails := fails || format('OWNER B so ve o proprio (%s)', res); end if;

  -- ---------- 6) sem escrita direta / append-only ----------
  res := pg_temp._runas('authenticated', u_owner_a, format('update public.support_tickets set status = ''resolved'' where id = %L returning 1', tk));
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('OWNER editou chamado direto (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, 'delete from public.support_messages returning 1');
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('OWNER apagou mensagens (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_admin, 'update public.support_messages set body = ''x'' returning 1');
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('admin editou mensagem direto (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_a, format('insert into public.support_messages (ticket_id, restaurant_id, author_kind, body) values (%L, %L, ''platform'', ''falso'') returning 1', tk, r_a));
  total := total + 1;
  if res not ilike '%permission denied%' then fails := fails || format('OWNER inseriu mensagem direta como platform (%s)', res); end if;

  -- ---------- 7) limites ----------
  for i in 1..9 loop
    perform pg_temp._runas('authenticated', u_owner_a, format('select public.support_create_ticket(%L, ''texto'', ''normal'')::text', 'Chamado numero ' || i));
  end loop;
  res := pg_temp._runas('authenticated', u_owner_a, $s$select public.support_create_ticket('Chamado onze', 'texto', 'normal')::text$s$);
  total := total + 1;
  if res not ilike '%too_many_open%' then fails := fails || format('11o chamado aberto deveria ser recusado (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_owner_b, $s$select public.support_create_ticket('Outra loja segue livre', 'texto', 'normal')::text$s$);
  total := total + 1;
  if res like 'ERR:%' then fails := fails || format('limite da loja A nao deveria afetar a B (%s)', res); end if;

  for i in 1..19 loop
    perform pg_temp._runas('authenticated', u_owner_b, format('select public.support_add_message(%L, %L)::text', tkb, 'msg ' || i));
  end loop;
  res := pg_temp._runas('authenticated', u_owner_b, format('select public.support_add_message(%L, ''msg 21'')::text', tkb));
  total := total + 1;
  if res not ilike '%rate_limited%' then fails := fails || format('21a mensagem na hora deveria ser limitada (%s)', res); end if;
  res := pg_temp._runas('authenticated', u_admin, format('select public.support_add_message(%L, ''plataforma nao e limitada'')::text', tkb));
  total := total + 1;
  if res like 'ERR:%' then fails := fails || format('limite nao vale para a plataforma (%s)', res); end if;

  -- ---------- 8) apagar a loja apaga os chamados ----------
  delete from public.restaurants where id = r_b;
  total := total + 1;
  if exists (select 1 from public.support_tickets where restaurant_id = r_b) or exists (select 1 from public.support_messages where restaurant_id = r_b) then
    fails := fails || 'chamados sobraram apos apagar a loja'::text;
  end if;

  if array_length(fails, 1) is null then
    raise exception 'RESULTADO: OK | % verificacoes', total;
  else
    raise exception 'RESULTADO: FALHOU (%) | % verificacoes | %', array_length(fails, 1), total, array_to_string(fails, ' ## ');
  end if;
end $$;

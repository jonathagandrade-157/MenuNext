-- MenuNext — teste de isolamento entre restaurantes (RLS + RPCs).
--
-- Como rodar: cole o arquivo inteiro no SQL Editor do Supabase (ou use
-- `psql -f`). É seguro em qualquer banco: tudo acontece dentro de UMA
-- transação que SEMPRE termina com `raise exception`, então nada é gravado.
-- A mensagem final do erro é o relatório:
--   RESULTADO: OK | N verificacoes ...          -> tudo isolado
--   RESULTADO: FALHOU (k) | ...                 -> lista cada violação
--
-- Pré-requisito: >= 2 restaurantes (um com OWNER que não é master) e 1 perfil
-- master. Os dados de teste (categoria, produto, pedido, nota) são criados
-- na hora, para a loja A e para a loja B; a loja A é aberta só dentro da
-- transação para o checkout público poder ser exercitado de verdade.
--
-- Personas, cada uma com o role e o JWT que o PostgREST usaria:
--   ua        dono da loja A (não é master)
--   stranger  usuário logado sem nenhuma loja
--   master    master da plataforma, que NÃO é membro da loja A
--   anon      visitante sem login
--
-- Esperado: ua e stranger nunca leem nem alteram a loja B/A de outro; o master
-- só enxerga lojas alheias pelas RPCs master_* (não por SELECT direto); anon
-- não lê nada privado e não executa RPCs de gestão.

do $$
declare
  a_id uuid; b_id uuid; ua_id uuid; master_id uuid;
  stranger_id uuid := gen_random_uuid();
  slug_a text; slug_b text;
  cat_a uuid; cat_b uuid; prod_a uuid; prod_b uuid; ord_a uuid; ord_b uuid; mem_b uuid;
  members_a bigint;
  b_status text; b_prod_name text; b_rest_name text; b_members bigint;
  c record; n bigint; ok boolean;
  fails text[] := '{}'; notes text[] := '{}'; total int := 0;
begin
  -- ---------- escolha dos atores ----------
  select r.id, r.slug, rm.user_id into a_id, slug_a, ua_id
  from public.restaurants r
  join public.restaurant_members rm on rm.restaurant_id = r.id and rm.role = 'OWNER'
  join public.profiles p on p.user_id = rm.user_id and not p.is_master
  order by r.created_at limit 1;
  select r.id, r.slug into b_id, slug_b from public.restaurants r where r.id <> a_id order by r.created_at limit 1;
  select p.user_id into master_id from public.profiles p where p.is_master limit 1;
  if a_id is null or b_id is null or master_id is null then
    raise exception 'PRE-REQUISITO: preciso de 2 restaurantes (um com OWNER nao-master) e 1 master.';
  end if;
  if exists (select 1 from public.restaurant_members where restaurant_id = a_id and user_id = master_id) then
    raise exception 'PRE-REQUISITO: o master nao pode ser membro da loja A.';
  end if;

  -- ---------- dados de teste (como dono do banco, sem RLS) ----------
  insert into public.categories (restaurant_id, name, display_order) values (a_id, 'iso-cat-a', 9001) returning id into cat_a;
  insert into public.categories (restaurant_id, name, display_order) values (b_id, 'iso-cat-b', 9001) returning id into cat_b;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (a_id, 'iso-prod-a', 10, cat_a, 9001) returning id into prod_a;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (b_id, 'iso-prod-b', 10, cat_b, 9001) returning id into prod_b;
  insert into public.orders (restaurant_id, order_number, customer_name, customer_phone, fulfillment_type, payment_method, subtotal, total, idempotency_key)
    values (a_id, 9001, 'iso', '11999999999', 'pickup', 'cash', 10, 10, 'iso-a') returning id into ord_a;
  insert into public.orders (restaurant_id, order_number, customer_name, customer_phone, fulfillment_type, payment_method, subtotal, total, idempotency_key)
    values (b_id, 9001, 'iso', '11999999999', 'pickup', 'cash', 10, 10, 'iso-b') returning id into ord_b;
  insert into public.customer_notes (restaurant_id, customer_phone, note, created_by)
    values (a_id, '11999999999', 'iso-a', ua_id), (b_id, '11999999999', 'iso-b', master_id);

  -- Abre a loja A só dentro desta transação (publicada, ativa, aberta 24h, com
  -- trial em vigor) para o teste de checkout ser conclusivo em qualquer dia.
  update public.restaurants set onboarding_completed = true, status = 'active', service_pickup = true where id = a_id;
  update public.profiles set trial_ends_at = now() + interval '30 days' where user_id = ua_id;
  delete from public.business_hours where restaurant_id = a_id;
  insert into public.business_hours (restaurant_id, day_of_week, opens_at, closes_at)
    select a_id, d, '00:00', '23:59:59' from generate_series(0, 6) d;

  select id into mem_b from public.restaurant_members where restaurant_id = b_id limit 1;
  select count(*) into members_a from public.restaurant_members where restaurant_id = a_id;

  -- ---------- casos: persona, expectativa, rotulo, comando ----------
  create temp table _cases (persona text, expect text, want bigint, label text, stmt text) on commit drop;

  -- ua: leitura isolada
  insert into _cases values
   ('ua','count',1,'ua ve o pedido da propria loja',        format('select count(*) from public.orders where restaurant_id = %L', a_id)),
   ('ua','count',0,'ua NAO ve pedidos da loja B',           format('select count(*) from public.orders where restaurant_id = %L', b_id)),
   ('ua','count',1,'ua ve notas da propria loja',           format('select count(*) from public.customer_notes where restaurant_id = %L', a_id)),
   ('ua','count',0,'ua NAO ve notas de clientes da loja B', format('select count(*) from public.customer_notes where restaurant_id = %L', b_id)),
   ('ua','count',0,'ua NAO ve membros da loja B',           format('select count(*) from public.restaurant_members where restaurant_id = %L', b_id)),
   ('ua','count',1,'ua ve a propria loja',                  format('select count(*) from public.restaurants where id = %L', a_id)),
   ('ua','count',0,'ua NAO ve a linha da loja B em restaurants', format('select count(*) from public.restaurants where id = %L', b_id)),
   ('ua','count',0,'ua NAO ve convites da loja B',          format('select count(*) from public.restaurant_invites where restaurant_id = %L', b_id)),
   ('ua','count',members_a,'get_restaurant_members devolve so a propria equipe', 'select count(*) from public.get_restaurant_members()');

  -- ua: escrita direta e RPCs contra a loja B (todas devem ser negadas)
  insert into _cases values
   ('ua','deny',null,'ua NAO altera pedido da loja B (update)',   format('update public.orders set status = %L where id = %L', 'cancelled', ord_b)),
   ('ua','deny',null,'ua NAO apaga pedido da loja B',            format('delete from public.orders where id = %L', ord_b)),
   ('ua','deny',null,'ua NAO altera produto da loja B',          format('update public.products set name = %L where id = %L', 'hack', prod_b)),
   ('ua','deny',null,'ua NAO apaga produto da loja B',           format('delete from public.products where id = %L', prod_b)),
   ('ua','deny',null,'ua NAO insere produto na loja B',          format('insert into public.products (restaurant_id, name, price, category_id, display_order) values (%L, %L, 1, %L, 99)', b_id, 'hack', cat_b)),
   ('ua','deny',null,'ua NAO altera categoria da loja B',        format('update public.categories set name = %L where id = %L', 'hack', cat_b)),
   ('ua','deny',null,'ua NAO altera a loja B (restaurants)',     format('update public.restaurants set name = %L where id = %L', 'hack', b_id)),
   ('ua','deny',null,'ua NAO cria nota de cliente na loja B',    format('insert into public.customer_notes (restaurant_id, customer_phone, note, created_by) values (%L, %L, %L, %L)', b_id, '11888888888', 'hack', ua_id)),
   ('ua','deny',null,'ua NAO se adiciona como membro da loja B', format('insert into public.restaurant_members (restaurant_id, user_id, role) values (%L, %L, %L)', b_id, ua_id, 'OWNER')),
   ('ua','deny',null,'RPC create_category na loja B',            format('select public.create_category(%L, %L, null)', b_id, 'hack')),
   ('ua','deny',null,'RPC create_product na loja B',             format('select public.create_product(%L, %L, %L, null, 1, null, true)', b_id, cat_b, 'hack')),
   ('ua','deny',null,'RPC create_addon_group na loja B',         format('select public.create_addon_group(%L, %L, null, 0, 1, false)', b_id, 'hack')),
   ('ua','deny',null,'RPC create_combo na loja B',               format('select public.create_combo(%L, %L, null, 1, true)', b_id, 'hack')),
   ('ua','deny',null,'RPC advance_order_status em pedido da loja B', format('select public.advance_order_status(%L)', ord_b)),
   ('ua','deny',null,'RPC cancel_order em pedido da loja B',     format('select public.cancel_order(%L, %L)', ord_b, 'hack')),
   ('ua','deny',null,'RPC move_category em categoria da loja B', format('select public.move_category(%L, %L)', cat_b, 'up')),
   ('ua','deny',null,'RPC update_product em produto da loja B',  format('select public.update_product(%L, %L, %L, null, 1, null, true)', prod_b, cat_b, 'hack')),
   ('ua','deny',null,'RPC remove_restaurant_member da loja B',   format('select public.remove_restaurant_member(%L)', mem_b)),
   ('ua','deny',null,'ua NAO cria venda de balcao na loja B', format('select * from public.create_order(%L, %L, %L, %L, %L, %L::jsonb, %L)', slug_b, 'x', '11999999999', 'counter', 'cash', jsonb_build_array(jsonb_build_object('product_id', prod_b, 'quantity', 1))::text, 'iso-c0'));

  -- ua: RPCs exclusivas do master (todas negadas) e controles positivos
  insert into _cases values
   ('ua','deny',null,'ua NAO executa master_list_restaurants',   'select * from public.master_list_restaurants(null, null, 25, 0)'),
   ('ua','deny',null,'ua NAO executa master_get_restaurant',     format('select * from public.master_get_restaurant(%L)', b_id)),
   ('ua','deny',null,'ua NAO executa master_dashboard_stats',    'select public.master_dashboard_stats()'),
   ('ua','deny',null,'ua NAO executa master_metrics',            'select public.master_metrics(30)'),
   ('ua','deny',null,'ua NAO se concede cortesia de trial',      format('select public.master_extend_trial(%L, 365)', a_id)),
   ('ua','deny',null,'ua NAO le o trial de outra loja',          format('select public.master_get_restaurant_trial(%L)', b_id)),
   ('ua','deny',null,'ua NAO altera platform_settings',          'select public.update_platform_settings(''a@b.co'', ''11999999999'')'),
   ('ua','allow',null,'CONTROLE: ua avanca pedido da propria loja', format('select public.advance_order_status(%L)', ord_a)),
   ('ua','allow',null,'CONTROLE: ua cria categoria na propria loja', format('select public.create_category(%L, %L, null)', a_id, 'iso-ok'));

  -- stranger: logado, sem loja
  insert into _cases values
   ('stranger','count',0,'sem loja NAO ve pedidos',             format('select count(*) from public.orders where restaurant_id = %L', a_id)),
   ('stranger','count',0,'sem loja NAO ve restaurants',         format('select count(*) from public.restaurants where id = %L', a_id)),
   ('stranger','count',0,'sem loja NAO ve membros',             format('select count(*) from public.restaurant_members where restaurant_id = %L', a_id)),
   ('stranger','count',0,'sem loja NAO ve notas de clientes',   format('select count(*) from public.customer_notes where restaurant_id = %L', a_id)),
   ('stranger','deny',null,'sem loja NAO altera pedido',        format('update public.orders set status = %L where id = %L', 'cancelled', ord_a)),
   ('stranger','deny',null,'sem loja: advance_order_status',    format('select public.advance_order_status(%L)', ord_a)),
   ('stranger','deny',null,'sem loja: cancel_order',            format('select public.cancel_order(%L, %L)', ord_a, 'hack')),
   ('stranger','deny',null,'sem loja: create_category',         format('select public.create_category(%L, %L, null)', a_id, 'hack')),
   ('stranger','deny',null,'sem loja: master_metrics',          'select public.master_metrics(30)'),
   ('stranger','deny',null,'sem loja NAO cria venda de balcao',  format('select * from public.create_order(%L, %L, %L, %L, %L, %L::jsonb, %L)', slug_a, 'x', '11999999999', 'counter', 'cash', jsonb_build_array(jsonb_build_object('product_id', prod_a, 'quantity', 1))::text, 'iso-c1'));

  -- master: so enxerga lojas alheias pelas RPCs master_*
  insert into _cases values
   ('master','count',0,'master NAO le pedidos de loja alheia por SELECT',  format('select count(*) from public.orders where restaurant_id = %L', a_id)),
   ('master','count',0,'master NAO le notas de clientes de loja alheia',   format('select count(*) from public.customer_notes where restaurant_id = %L', a_id)),
   ('master','count',0,'master NAO le restaurants alheio por SELECT',      format('select count(*) from public.restaurants where id = %L', a_id)),
   ('master','deny',null,'master NAO altera pedido de loja alheia',        format('update public.orders set status = %L where id = %L', 'cancelled', ord_a)),
   ('master','deny',null,'master NAO altera produto de loja alheia',       format('update public.products set name = %L where id = %L', 'hack', prod_a)),
   ('master','deny',null,'master: advance_order_status em loja alheia',    format('select public.advance_order_status(%L)', ord_a)),
   ('master','deny',null,'master: cancel_order em loja alheia',            format('select public.cancel_order(%L, %L)', ord_a, 'hack')),
   ('master','deny',null,'master: create_category em loja alheia',         format('select public.create_category(%L, %L, null)', a_id, 'hack')),
   ('master','allow',null,'CONTROLE: master le a loja pela RPC master_get_restaurant', format('select * from public.master_get_restaurant(%L)', a_id)),
   ('master','allow',null,'CONTROLE: master executa master_metrics',       'select public.master_metrics(30)');

  -- anon: visitante sem login
  insert into _cases values
   ('anon','count',0,'anon NAO le pedidos',            'select count(*) from public.orders'),
   ('anon','count',0,'anon NAO le restaurants',        'select count(*) from public.restaurants'),
   ('anon','count',0,'anon NAO le profiles',           'select count(*) from public.profiles'),
   ('anon','count',0,'anon NAO le membros',            'select count(*) from public.restaurant_members'),
   ('anon','count',0,'anon NAO le notas de clientes',  'select count(*) from public.customer_notes'),
   ('anon','deny',null,'anon NAO altera pedido',       format('update public.orders set status = %L where id = %L', 'cancelled', ord_a)),
   ('anon','deny',null,'anon: advance_order_status',   format('select public.advance_order_status(%L)', ord_a)),
   ('anon','deny',null,'anon: master_metrics',         'select public.master_metrics(30)'),
   ('anon','deny',null,'anon: master_extend_trial',    format('select public.master_extend_trial(%L, 365)', a_id)),
   ('anon','deny',null,'anon: webhook com token errado', 'select public.process_asaas_webhook(''token-errado'', ''evt-iso'', ''X'', ''sub-iso'', ''active'', null)'),
   ('anon','deny',null,'anon NAO cria venda de balcao (counter)', format('select * from public.create_order(%L, %L, %L, %L, %L, %L::jsonb, %L)', slug_a, 'x', '11999999999', 'counter', 'cash', jsonb_build_array(jsonb_build_object('product_id', prod_a, 'quantity', 1))::text, 'iso-c2'));

  -- ---------- execução ----------
  for c in select * from _cases loop
    total := total + 1;
    reset role;
    perform set_config('request.jwt.claims',
      case c.persona
        when 'anon' then ''
        else json_build_object('sub', case c.persona when 'ua' then ua_id when 'master' then master_id else stranger_id end, 'role', 'authenticated')::text
      end, true);
    execute format('set local role %I', case c.persona when 'anon' then 'anon' else 'authenticated' end);

    if c.expect = 'count' then
      begin
        execute c.stmt into n;
      exception when others then
        n := 0; -- permission denied conta como "nao viu nada"
      end;
      if n is distinct from c.want then
        fails := fails || format('%s (viu %s, esperado %s)', c.label, n, c.want);
      end if;
    else
      begin
        execute c.stmt;
        get diagnostics n = row_count;
        ok := n > 0;
      exception when others then
        ok := false;
      end;
      if c.expect = 'deny' and ok then
        fails := fails || format('%s (FOI PERMITIDO)', c.label);
      elsif c.expect = 'allow' and not ok then
        fails := fails || format('%s (foi negado; teste sem valor)', c.label);
      end if;
    end if;
  end loop;
  reset role;

  -- ---------- o checkout publico nao aceita produto de outra loja ----------
  total := total + 1;
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin
    perform public.create_order(slug_a, 'Teste', '11999999999', 'pickup', 'cash',
      jsonb_build_array(jsonb_build_object('product_id', prod_b, 'quantity', 1)), 'iso-x1');
    fails := fails || 'create_order ACEITOU produto de outra loja (FOI PERMITIDO)'::text;
  exception when others then
    if sqlerrm not like '%product_not_found%' then
      notes := notes || ('create_order cross-tenant barrado por outro motivo (inconclusivo): ' || sqlerrm);
    else
      notes := notes || 'create_order recusa produto de outra loja (product_not_found): ok'::text;
    end if;
  end;
  begin
    perform public.create_order(slug_a, 'Teste', '11999999999', 'pickup', 'cash',
      jsonb_build_array(jsonb_build_object('product_id', prod_a, 'quantity', 1)), 'iso-x2');
    notes := notes || 'controle create_order (produto da propria loja): ok'::text;
  exception when others then
    notes := notes || ('controle create_order indisponivel: ' || sqlerrm);
  end;
  reset role;

  -- ---------- nada foi alterado nos dados da loja B ----------
  select status into b_status from public.orders where id = ord_b;
  select name into b_prod_name from public.products where id = prod_b;
  select name into b_rest_name from public.restaurants where id = b_id;
  select count(*) into b_members from public.restaurant_members where restaurant_id = b_id;
  total := total + 4;
  if b_status is distinct from 'received' then fails := fails || ('pedido da loja B mudou para ' || coalesce(b_status, 'apagado')); end if;
  if b_prod_name is distinct from 'iso-prod-b' then fails := fails || ('produto da loja B mudou para ' || coalesce(b_prod_name, 'apagado')); end if;
  if b_rest_name = 'hack' then fails := fails || 'nome da loja B foi alterado'::text; end if;
  if b_members < 1 then fails := fails || 'membros da loja B foram removidos'::text; end if;

  -- sempre desfaz tudo; a mensagem e o relatorio
  if array_length(fails, 1) is null then
    raise exception 'RESULTADO: OK | % verificacoes | notas: %', total, coalesce(array_to_string(notes, ' ; '), '-');
  else
    raise exception 'RESULTADO: FALHOU (%) | % verificacoes | %  || notas: %', array_length(fails, 1), total,
      array_to_string(fails, ' ## '), coalesce(array_to_string(notes, ' ; '), '-');
  end if;
end $$;

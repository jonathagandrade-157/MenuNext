-- MenuNext — teste de regressão do P1-02c: caminho canônico nas policies de storage.objects.
--
-- ATENÇÃO — RODE SÓ EM BANCO ISOLADO (local, branch do Supabase ou banco de teste). O script cria
-- usuários em auth.users, lojas e objetos de teste. Tudo fica dentro de UMA transação que SEMPRE termina
-- com `raise exception`, então nada persiste, mas NÃO use contra o banco de produção.
--
-- Como ler o resultado: a mensagem final do erro é o relatório.
--   RESULTADO: OK | N verificacoes
--   RESULTADO: FALHOU (k) | N verificacoes | ...
--
-- O que prova: o isolamento entre restaurantes vem da POLICY (e não do backend de objetos). Cada nome
-- é inserido/renomeado/apagado diretamente em storage.objects com o role e o JWT que a API usaria.
-- Pré-requisito: migrations até 20261009040000_storage_path_canonical.sql aplicadas.

do $$
declare
  u_owner_a uuid := gen_random_uuid();
  u_staff_a uuid := gen_random_uuid();
  u_owner_b uuid := gen_random_uuid();
  r_a uuid; r_b uuid;
  a text; b text; prod uuid := gen_random_uuid();
  c record; err text; n bigint; ok boolean;
  fails text[] := '{}'; total int := 0;
  v uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (u_owner_a, 'owner-a@storage.test', jsonb_build_object('name','Owner A','phone','11999990001','document','52998224725')),
    (u_staff_a, 'staff-a@storage.test', jsonb_build_object('name','Staff A','phone','11999990002','document','11144477735')),
    (u_owner_b, 'owner-b@storage.test', jsonb_build_object('name','Owner B','phone','11999990003','document','39053344705'));
  insert into public.restaurants (name, slug) values ('Loja A', 'stor-hard-a') returning id into r_a;
  insert into public.restaurants (name, slug) values ('Loja B', 'stor-hard-b') returning id into r_b;
  insert into public.restaurant_members (restaurant_id, user_id, role) values
    (r_a, u_owner_a, 'OWNER'), (r_a, u_staff_a, 'STAFF'), (r_b, u_owner_b, 'OWNER');
  a := r_a::text; b := r_b::text;
  -- o Storage real bloqueia DELETE direto em storage.objects; a API habilita esta configuracao por transacao
  perform set_config('storage.allow_delete_query', 'true', true);

  -- ---------- fase 0: a função devolve null para tudo que não é o caminho canônico ----------
  for c in select * from (values
    (a || '/branding/logo.png', true),
    (a || '/products/' || prod || '/1.jpg', true),
    (a || '/banners/' || prod || '.webp', true),
    (a || '/combos/' || prod || '/image.png', true),
    (a || '/../' || b || '/branding/logo.png', false),
    (a || '/./logo.png', false),
    (a || '//logo.png', false),
    ('/' || a || '/logo.png', false),
    ('./' || a || '/logo.png', false),
    (a || '/%2e%2e/' || b || '/logo.png', false),
    (a || '/..%2F' || b || '/logo.png', false),
    (a || '\..\' || b || '\logo.png', false),
    (upper(a) || '/logo.png', false),
    ('{' || a || '}/logo.png', false),
    (replace(a, '-', '') || '/logo.png', false),
    (a || '/', false),
    (a, false),
    (a || '/logo.png/..', false),
    (a || '/logo.png' || chr(10) || '/../x', false),
    (' ' || a || '/logo.png', false),
    (a || '/ logo.png', false),
    ('', false),
    ('nao-e-uuid/logo.png', false)
  ) as t(nm, canonico) loop
    total := total + 1;
    v := public.storage_path_restaurant_id(c.nm);
    if c.canonico and v is distinct from r_a then
      fails := fails || format('funcao: caminho canonico recusado: %L', c.nm);
    elsif not c.canonico and v is not null then
      fails := fails || format('funcao: caminho NAO canonico aceito: %L', c.nm);
    end if;
  end loop;
  total := total + 1;
  if public.storage_path_restaurant_id(null) is not null then fails := fails || 'funcao: null aceito'::text; end if;

  -- ---------- fase 1: as policies, com role e JWT como a API faz ----------
  -- objetos existentes (semeados pelo dono do banco): um canônico de A, um canônico de B, um legado não canônico
  insert into storage.objects (bucket_id, name) values
    ('restaurant-assets', a || '/own.png'), ('restaurant-assets', a || '/rename.png'), ('restaurant-assets', a || '/rename-ok.png'), ('restaurant-assets', a || '/del.png'),
    ('restaurant-assets', b || '/other.png'), ('restaurant-assets', b || '/other-del.png'),
    ('restaurant-assets', a || '/../' || b || '/legacy.png');

  for c in select * from (values
    -- persona, esperado, rotulo, sql
    ('owner_a','allow','OWNER A envia logo canonico',            format('insert into storage.objects (bucket_id, name) values (''restaurant-assets'', %L)', a || '/branding/logo.png')),
    ('owner_a','allow','OWNER A envia imagem de produto',        format('insert into storage.objects (bucket_id, name) values (''restaurant-assets'', %L)', a || '/products/' || prod || '/1.jpg')),
    ('owner_a','allow','OWNER A envia imagem de combo',          format('insert into storage.objects (bucket_id, name) values (''restaurant-assets'', %L)', a || '/combos/' || prod || '/image.webp')),
    ('owner_a','deny', 'OWNER A: segmento .. para a loja B',     format('insert into storage.objects (bucket_id, name) values (''restaurant-assets'', %L)', a || '/../' || b || '/branding/logo.png')),
    ('owner_a','deny', 'OWNER A: segmento . ',                   format('insert into storage.objects (bucket_id, name) values (''restaurant-assets'', %L)', a || '/./logo.png')),
    ('owner_a','deny', 'OWNER A: segmento vazio (//)',           format('insert into storage.objects (bucket_id, name) values (''restaurant-assets'', %L)', a || '//logo.png')),
    ('owner_a','deny', 'OWNER A: barra inicial',                 format('insert into storage.objects (bucket_id, name) values (''restaurant-assets'', %L)', '/' || a || '/logo.png')),
    ('owner_a','deny', 'OWNER A: ./ inicial',                    format('insert into storage.objects (bucket_id, name) values (''restaurant-assets'', %L)', './' || a || '/logo.png')),
    ('owner_a','deny', 'OWNER A: .. codificado (%2e%2e)',        format('insert into storage.objects (bucket_id, name) values (''restaurant-assets'', %L)', a || '/%2e%2e/' || b || '/logo.png')),
    ('owner_a','deny', 'OWNER A: barra codificada (..%2F)',      format('insert into storage.objects (bucket_id, name) values (''restaurant-assets'', %L)', a || '/..%2F' || b || '/logo.png')),
    ('owner_a','deny', 'OWNER A: barra invertida',               format('insert into storage.objects (bucket_id, name) values (''restaurant-assets'', %L)', a || '\..\' || b || '\logo.png')),
    ('owner_a','deny', 'OWNER A: uuid em maiusculas',            format('insert into storage.objects (bucket_id, name) values (''restaurant-assets'', %L)', upper(a) || '/logo.png')),
    ('owner_a','deny', 'OWNER A: uuid entre chaves',             format('insert into storage.objects (bucket_id, name) values (''restaurant-assets'', %L)', '{' || a || '}/logo.png')),
    ('owner_a','deny', 'OWNER A: uuid sem hifens',               format('insert into storage.objects (bucket_id, name) values (''restaurant-assets'', %L)', replace(a, '-', '') || '/logo.png')),
    ('owner_a','deny', 'OWNER A: pasta sem arquivo (termina em /)', format('insert into storage.objects (bucket_id, name) values (''restaurant-assets'', %L)', a || '/')),
    ('owner_a','deny', 'OWNER A: .. no fim',                    format('insert into storage.objects (bucket_id, name) values (''restaurant-assets'', %L)', a || '/logo.png/..')),
    ('owner_a','deny', 'OWNER A: quebra de linha no nome',       format('insert into storage.objects (bucket_id, name) values (''restaurant-assets'', %L)', a || '/logo.png' || chr(10) || '/../x')),
    ('owner_a','deny', 'OWNER A: espaco inicial',                format('insert into storage.objects (bucket_id, name) values (''restaurant-assets'', %L)', ' ' || a || '/logo.png')),
    ('owner_a','deny', 'OWNER A envia para a pasta da loja B',   format('insert into storage.objects (bucket_id, name) values (''restaurant-assets'', %L)', b || '/hack.png')),
    ('owner_a','deny', 'OWNER A: uuid da loja B em maiusculas',  format('insert into storage.objects (bucket_id, name) values (''restaurant-assets'', %L)', upper(b) || '/hack.png')),
    ('owner_a','deny', 'OWNER A: uuid da loja B entre chaves',   format('insert into storage.objects (bucket_id, name) values (''restaurant-assets'', %L)', '{' || b || '}/hack.png')),
    ('owner_a','deny', 'OWNER A: ../ levando a B com o 1o segmento de B', format('insert into storage.objects (bucket_id, name) values (''restaurant-assets'', %L)', b || '/../' || a || '/x.png')),
    ('owner_a','deny', 'OWNER A em outro bucket',                format('insert into storage.objects (bucket_id, name) values (''avatars'', %L)', a || '/x.png')),
    ('staff_a','deny', 'STAFF A nao envia nem na propria loja',  format('insert into storage.objects (bucket_id, name) values (''restaurant-assets'', %L)', a || '/branding/staff.png')),
    ('anon',   'deny', 'anon nao envia',                         format('insert into storage.objects (bucket_id, name) values (''restaurant-assets'', %L)', a || '/branding/anon.png')),
    -- renomear (UPDATE name) passa pelo WITH CHECK com o nome NOVO
    ('owner_a','deny', 'OWNER A renomeia para a pasta da loja B', format('update storage.objects set name = %L where bucket_id = ''restaurant-assets'' and name = %L', b || '/stolen.png', a || '/rename.png')),
    ('owner_a','deny', 'OWNER A renomeia para ..',               format('update storage.objects set name = %L where bucket_id = ''restaurant-assets'' and name = %L', a || '/../' || b || '/stolen.png', a || '/rename.png')),
    ('owner_a','allow','OWNER A renomeia dentro da propria pasta', format('update storage.objects set name = %L where bucket_id = ''restaurant-assets'' and name = %L', a || '/renamed.png', a || '/rename-ok.png')),
    ('owner_b','deny', 'OWNER B atualiza objeto da loja A',      format('update storage.objects set name = name where bucket_id = ''restaurant-assets'' and name = %L', a || '/own.png')),
    -- apagar
    ('owner_b','deny', 'OWNER B apaga objeto da loja A',         format('delete from storage.objects where bucket_id = ''restaurant-assets'' and name = %L', a || '/del.png')),
    ('staff_a','deny', 'STAFF A apaga objeto da propria loja',   format('delete from storage.objects where bucket_id = ''restaurant-assets'' and name = %L', a || '/del.png')),
    ('anon',   'deny', 'anon apaga objeto',                      format('delete from storage.objects where bucket_id = ''restaurant-assets'' and name = %L', a || '/del.png')),
    ('owner_a','deny', 'OWNER A apaga objeto da loja B',         format('delete from storage.objects where bucket_id = ''restaurant-assets'' and name = %L', b || '/other-del.png')),
    ('owner_a','deny', 'OWNER A apaga objeto legado nao canonico (fica so para o dono do banco)', format('delete from storage.objects where bucket_id = ''restaurant-assets'' and name = %L', a || '/../' || b || '/legacy.png')),
    ('owner_a','deny', 'OWNER A altera objeto legado nao canonico', format('update storage.objects set metadata = ''{}''::jsonb where bucket_id = ''restaurant-assets'' and name = %L', a || '/../' || b || '/legacy.png')),
    ('owner_a','allow','OWNER A apaga objeto da propria loja',   format('delete from storage.objects where bucket_id = ''restaurant-assets'' and name = %L', a || '/del.png'))
  ) as t(persona, expect, label, stmt) loop
    total := total + 1;
    err := null; n := null;
    reset role;
    begin
      perform set_config('request.jwt.claims', case c.persona
        when 'owner_a' then jsonb_build_object('sub', u_owner_a, 'role', 'authenticated')::text
        when 'staff_a' then jsonb_build_object('sub', u_staff_a, 'role', 'authenticated')::text
        when 'owner_b' then jsonb_build_object('sub', u_owner_b, 'role', 'authenticated')::text
        else jsonb_build_object('role', 'anon')::text end, true);
      execute format('set local role %I', case c.persona when 'anon' then 'anon' else 'authenticated' end);
      execute c.stmt;
      get diagnostics n = row_count;
    exception when others then
      err := sqlerrm;
    end;
    reset role;
    if c.expect = 'allow' then
      if err is not null then fails := fails || format('%s (ERRO: %s)', c.label, err);
      elsif n < 1 then fails := fails || format('%s (0 linhas)', c.label); end if;
    else
      if err is null and n > 0 then
        fails := fails || format('%s (FOI PERMITIDO: %s linhas)', c.label, n);
      elsif err is not null and err !~* 'row-level security|permission denied|violates' then
        fails := fails || format('%s (barrado por outro motivo, inconclusivo: %s)', c.label, err);
      end if;
    end if;
  end loop;
  reset role;

  -- estado final conferido pelo dono do banco
  total := total + 1;
  select count(*) into n from storage.objects where bucket_id = 'restaurant-assets' and name like b || '/%' and name not in (b || '/other.png', b || '/other-del.png');
  if n <> 0 then fails := fails || format('objetos indevidos na pasta da loja B: %s', n); end if;
  total := total + 1;
  select count(*) into n from storage.objects where bucket_id = 'restaurant-assets' and name = a || '/../' || b || '/legacy.png';
  if n <> 1 then fails := fails || 'objeto legado nao canonico foi alterado/apagado pela API'::text; end if;
  total := total + 1;
  select count(*) into n from storage.objects where bucket_id = 'restaurant-assets' and name in (b || '/other.png', b || '/other-del.png');
  if n <> 2 then fails := fails || 'objetos da loja B foram alterados/apagados'::text; end if;

  if array_length(fails, 1) is null then
    raise exception 'RESULTADO: OK | % verificacoes', total;
  else
    raise exception 'RESULTADO: FALHOU (%) | % verificacoes | %', array_length(fails, 1), total, array_to_string(fails, ' ## ');
  end if;
end $$;

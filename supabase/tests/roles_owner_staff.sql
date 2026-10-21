-- MenuNext — teste de regressão do P1-02: papéis OWNER e STAFF no banco.
--
-- ATENÇÃO — RODE SÓ EM BANCO ISOLADO (local, branch do Supabase ou banco de
-- teste). O script cria usuários em auth.users, lojas e linhas de teste. Tudo
-- fica dentro de UMA transação que SEMPRE termina com `raise exception`, então
-- nada persiste, mas NÃO use contra o banco de produção.
--
-- Como ler o resultado: a mensagem final do erro é o relatório.
--   RESULTADO: OK | N verificacoes            -> papéis respeitados
--   RESULTADO: FALHOU (k) | N verificacoes | ... -> lista cada violação
--
-- Regra testada (decisão do produto):
--   OWNER: tudo. STAFF: opera pedidos e liga/desliga a DISPONIBILIDADE de
--   produtos e adicionais; NADA além disso (cardápio, preços, cupons, zonas,
--   horários, Pix, aparência, informações, pausar a loja, convites, arquivos).
--
-- Personas (role e JWT iguais aos do PostgREST):
--   owner_a / staff_a   OWNER e STAFF da loja A      owner_b   OWNER da loja B
--   master              master da plataforma, NÃO membro da loja A
--   stranger            logado, sem loja             anon      visitante
--   service             role service_role (backend)  sys       dono do banco, sem JWT
--
-- Cada ataque de escrita precisa ser barrado pela CAMADA ESPERADA (RLS, trigger
-- de guarda ou checagem da RPC). Um erro de outro tipo (constraint, tipo...) é
-- reportado como "barrado por outro motivo": o teste não pode passar por acaso.
--
-- Fases: 0 catálogo | 1 ataques | 2 controles do STAFF e pedidos |
--        3 controles do OWNER | 4 outras personas | 5 checkout e cupom

do $$
declare
  u_owner_a uuid := gen_random_uuid();
  u_staff_a uuid := gen_random_uuid();
  u_owner_b uuid := gen_random_uuid();
  u_master  uuid := gen_random_uuid();
  u_stranger uuid := gen_random_uuid();
  r_a uuid; r_b uuid;
  cat_a uuid; cat_a2 uuid; cat_del uuid; cat_b uuid;
  prod_a uuid; prod_a2 uuid; prod_del uuid; prod_b uuid;
  grp_a uuid; grp_del uuid; add_a uuid; add_a2 uuid; add_del uuid;
  combo_a uuid; combo_del uuid; citem_a uuid; citem_del uuid; pag_a uuid; pag_del uuid;
  img_a uuid; img_del uuid; coupon_a uuid; coupon_del uuid; zone_a uuid; zone_del uuid;
  hrs_a uuid; hrs_del uuid; inv_a uuid; mem_staff uuid;
  ord_a uuid; ord_done uuid; ord_cancel uuid; ord_b uuid;
  slug_a text := 'iso-roles-a';
  obj_a text; obj_del text; obj_b text;
  tbl text; fn text;
  trig_tables text[] := array['products','categories','addon_groups','addons','combos','combo_items',
                              'product_addon_groups','product_images'];
  owner_rpcs text[] := array['create_category','move_category','create_product','update_product','move_product',
    'move_product_image','create_addon_group','update_addon_group','move_addon_group','create_addon','update_addon',
    'move_addon','add_product_addon_group','move_product_addon_group','create_combo','update_combo','move_combo',
    'add_combo_item','update_combo_item','move_combo_item'];
  dml_needle text := 'row-level security|owner_required|permission denied';
  rpc_needle text := 'not_authorized|owner_required|permission denied';

  c record; n bigint; ok boolean; err text; v_ok boolean; v_phase int;
  fails text[] := '{}'; notes text[] := '{}'; total int := 0;
begin
  -- ---------- setup (como dono do banco, sem JWT) ----------
  insert into auth.users (id, email, raw_user_meta_data) values
    (u_owner_a, 'owner-a@roles.test', jsonb_build_object('name','Owner A','phone','11999990001','document','52998224725')),
    (u_staff_a, 'staff-a@roles.test', jsonb_build_object('name','Staff A','phone','11999990002','document','11144477735')),
    (u_owner_b, 'owner-b@roles.test', jsonb_build_object('name','Owner B','phone','11999990003','document','39053344705')),
    (u_master,  'master@roles.test',  jsonb_build_object('name','Master','phone','11999990004','document','12345678909'));
  update public.profiles set is_master = true where user_id = u_master;
  update public.profiles set trial_ends_at = now() + interval '30 days' where user_id in (u_owner_a, u_owner_b);

  insert into public.restaurants (name, slug) values ('Loja A', slug_a) returning id into r_a;
  insert into public.restaurants (name, slug) values ('Loja B', 'iso-roles-b') returning id into r_b;
  insert into public.onboarding_progress (restaurant_id, current_step, completed_steps)
    values (r_a, 2, '{}') on conflict (restaurant_id) do update set current_step = 2;
  insert into public.restaurant_members (restaurant_id, user_id, role) values (r_a, u_owner_a, 'OWNER');
  insert into public.restaurant_members (restaurant_id, user_id, role) values (r_a, u_staff_a, 'STAFF') returning id into mem_staff;
  insert into public.restaurant_members (restaurant_id, user_id, role) values (r_b, u_owner_b, 'OWNER');

  -- loja A aberta (so dentro da transacao) para exercitar pedidos e checkout de verdade
  update public.restaurants set onboarding_completed = true, status = 'active', service_pickup = true,
         payment_pix = true, payment_pix_key = 'pix-original@roles.test', payment_pix_key_type = 'email',
         delivery_fee = 5, bio = 'bio-original' where id = r_a;
  delete from public.business_hours where restaurant_id = r_a;
  insert into public.business_hours (restaurant_id, day_of_week, opens_at, closes_at, period_order)
    select r_a, d, '00:00', '23:59:59', 1 from generate_series(0, 6) d;
  select id into hrs_a from public.business_hours where restaurant_id = r_a and day_of_week = 1 and period_order = 1;
  insert into public.business_hours (restaurant_id, day_of_week, opens_at, closes_at, period_order)
    values (r_a, 0, '01:00', '02:00', 2) returning id into hrs_del;

  insert into public.categories (restaurant_id, name, display_order) values (r_a, 'cat-a', 9001) returning id into cat_a;
  insert into public.categories (restaurant_id, name, display_order) values (r_a, 'cat-a2', 9002) returning id into cat_a2;
  insert into public.categories (restaurant_id, name, display_order) values (r_a, 'cat-del', 9003) returning id into cat_del;
  insert into public.categories (restaurant_id, name, display_order) values (r_b, 'cat-b', 9001) returning id into cat_b;
  insert into public.products (restaurant_id, name, description, price, cost, category_id, display_order)
    values (r_a, 'prod-a', 'desc-a', 10, 2.5, cat_a, 9001) returning id into prod_a;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (r_a, 'prod-a2', 12, cat_a, 9002) returning id into prod_a2;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (r_a, 'prod-del', 8, cat_a, 9003) returning id into prod_del;
  insert into public.products (restaurant_id, name, price, category_id, display_order) values (r_b, 'prod-b', 10, cat_b, 9001) returning id into prod_b;
  insert into public.addon_groups (restaurant_id, name, display_order) values (r_a, 'grp-a', 9001) returning id into grp_a;
  insert into public.addon_groups (restaurant_id, name, display_order) values (r_a, 'grp-del', 9002) returning id into grp_del;
  insert into public.addons (restaurant_id, addon_group_id, name, price, display_order) values (r_a, grp_a, 'add-a', 2, 9001) returning id into add_a;
  insert into public.addons (restaurant_id, addon_group_id, name, price, display_order) values (r_a, grp_a, 'add-a2', 3, 9002) returning id into add_a2;
  insert into public.addons (restaurant_id, addon_group_id, name, price, display_order) values (r_a, grp_a, 'add-del', 1, 9003) returning id into add_del;
  insert into public.combos (restaurant_id, name, price, display_order) values (r_a, 'combo-a', 30, 9001) returning id into combo_a;
  insert into public.combos (restaurant_id, name, price, display_order) values (r_a, 'combo-del', 30, 9002) returning id into combo_del;
  insert into public.combo_items (restaurant_id, combo_id, product_id, quantity, display_order) values (r_a, combo_a, prod_a, 1, 1) returning id into citem_a;
  insert into public.combo_items (restaurant_id, combo_id, product_id, quantity, display_order) values (r_a, combo_del, prod_a, 1, 1) returning id into citem_del;
  insert into public.product_addon_groups (restaurant_id, product_id, addon_group_id, display_order) values (r_a, prod_a, grp_a, 1) returning id into pag_a;
  insert into public.product_addon_groups (restaurant_id, product_id, addon_group_id, display_order) values (r_a, prod_del, grp_a, 1) returning id into pag_del;
  insert into public.product_images (restaurant_id, product_id, storage_path, display_order) values (r_a, prod_a, r_a || '/roles-img-a.png', 1) returning id into img_a;
  insert into public.product_images (restaurant_id, product_id, storage_path, display_order) values (r_a, prod_a, r_a || '/roles-img-del.png', 2) returning id into img_del;
  insert into public.coupons (restaurant_id, code, discount_type, discount_value) values (r_a, 'ROLES10', 'percent', 10) returning id into coupon_a;
  insert into public.coupons (restaurant_id, code, discount_type, discount_value) values (r_a, 'ROLESDEL', 'fixed', 1) returning id into coupon_del;
  insert into public.delivery_zones (restaurant_id, neighborhood, delivery_fee) values (r_a, 'Centro', 5) returning id into zone_a;
  insert into public.delivery_zones (restaurant_id, neighborhood, delivery_fee) values (r_a, 'Zona Del', 5) returning id into zone_del;
  insert into public.restaurant_invites (restaurant_id, email, role, invited_by) values (r_a, 'novo@roles.test', 'STAFF', u_owner_a) returning id into inv_a;

  insert into public.orders (restaurant_id, order_number, customer_name, customer_phone, fulfillment_type, payment_method, subtotal, total, idempotency_key)
    values (r_a, 9001, 'cli', '11999999999', 'pickup', 'cash', 10, 10, 'roles-a1') returning id into ord_a;
  insert into public.orders (restaurant_id, order_number, customer_name, customer_phone, fulfillment_type, payment_method, subtotal, total, idempotency_key, status, picked_up_at)
    values (r_a, 9002, 'cli', '11999999999', 'pickup', 'cash', 10, 10, 'roles-a2', 'picked_up', now()) returning id into ord_done;
  insert into public.orders (restaurant_id, order_number, customer_name, customer_phone, fulfillment_type, payment_method, subtotal, total, idempotency_key)
    values (r_a, 9003, 'cli', '11999999999', 'pickup', 'cash', 10, 10, 'roles-a3') returning id into ord_cancel;
  insert into public.orders (restaurant_id, order_number, customer_name, customer_phone, fulfillment_type, payment_method, subtotal, total, idempotency_key)
    values (r_b, 9001, 'cli', '11999999999', 'pickup', 'cash', 10, 10, 'roles-b1') returning id into ord_b;

  -- arquivos da loja (storage): o primeiro de A, um para apagar, um de B
  obj_a := r_a || '/roles-logo.png'; obj_del := r_a || '/roles-del.png'; obj_b := r_b || '/roles-logo-b.png';
  insert into storage.buckets (id, name, public) values ('restaurant-assets', 'restaurant-assets', true) on conflict (id) do nothing;
  insert into storage.objects (bucket_id, name) values ('restaurant-assets', obj_a), ('restaurant-assets', obj_del), ('restaurant-assets', obj_b);

  -- para provar que o trigger set_updated_at continua rodando: updated_at antigo
  alter table public.products disable trigger set_updated_at;
  alter table public.addons disable trigger set_updated_at;
  update public.products set updated_at = '2020-01-01 00:00:00+00' where id in (prod_a, prod_a2);
  update public.addons set updated_at = '2020-01-01 00:00:00+00' where id in (add_a, add_a2);
  alter table public.products enable trigger set_updated_at;
  alter table public.addons enable trigger set_updated_at;

  -- funcoes SECURITY DEFINER "legadas" (simulam uma RPC antiga/nova SEM checagem de papel): ignoram a RLS,
  -- entao so o trigger de guarda pode barrar. Sao criadas dentro da transacao e desfeitas no fim.
  create function public._roles_t_legacy(p_op text, p_id uuid, p_restaurant uuid) returns void
    language plpgsql security definer set search_path to 'public' as $f$
  begin
    if p_op = 'toggle_product' then update public.products set is_available = false where id = p_id;
    elsif p_op = 'rename_and_toggle_product' then update public.products set is_available = false, name = 'legacy-hack' where id = p_id;
    elsif p_op = 'toggle_combo' then update public.combos set is_available = false where id = p_id;
    elsif p_op = 'toggle_addon_group' then update public.addon_groups set is_active = false where id = p_id;
    elsif p_op = 'delete_product' then delete from public.products where id = p_id;
    elsif p_op = 'insert_category' then insert into public.categories (restaurant_id, name, display_order) values (p_restaurant, 'legacy-hack', 1);
    elsif p_op = 'move_product_to_b' then update public.products set is_available = false, restaurant_id = p_restaurant where id = p_id;
    end if;
  end $f$;
  grant execute on function public._roles_t_legacy(text, uuid, uuid) to authenticated;

  create temp table _cases (
    ord serial, phase int, persona text, expect text, needle text,
    label text, stmt text, verify text, want bigint
  ) on commit drop;

  -- ============================================================
  -- FASE 0 — catálogo (estado do banco)
  -- ============================================================
  insert into _cases (phase, persona, expect, label, stmt, verify) values
   (0,'sys','check','is_restaurant_owner existe; authenticated executa; anon NAO','select 1',
    $v$ has_function_privilege('authenticated','public.is_restaurant_owner(uuid)','EXECUTE')
        and not has_function_privilege('anon','public.is_restaurant_owner(uuid)','EXECUTE') $v$),
   (0,'sys','check','funcao de guarda NAO e executavel por authenticated/anon','select 1',
    $v$ not has_function_privilege('authenticated','public.guard_owner_only_writes()','EXECUTE')
        and not has_function_privilege('anon','public.guard_owner_only_writes()','EXECUTE') $v$),
   (0,'sys','check','nenhuma politica de escrita por MEMBRO resta, exceto UPDATE de products/addons','select 1',
    $v$ not exists (select 1 from pg_policies where schemaname = 'public' and cmd in ('INSERT','UPDATE','DELETE')
                    and policyname like '%\_members' escape '\' and tablename not in ('products','addons')) $v$),
   (0,'sys','check','products/addons: INSERT e DELETE por membro foram removidos; UPDATE por membro permanece (STAFF liga/desliga)','select 1',
    $v$ (select count(*) from pg_policies where schemaname = 'public' and tablename in ('products','addons')
          and cmd in ('INSERT','DELETE') and policyname like '%\_members' escape '\') = 0
        and (select count(*) from pg_policies where schemaname = 'public' and tablename in ('products','addons')
          and cmd = 'UPDATE' and policyname like '%\_update\_members' escape '\') = 2 $v$),
   (0,'sys','check','restaurants: politica de UPDATE e do OWNER','select 1',
    $v$ exists (select 1 from pg_policies where schemaname='public' and tablename='restaurants' and cmd='UPDATE'
                and qual like '%is_restaurant_owner%')
        and not exists (select 1 from pg_policies where schemaname='public' and tablename='restaurants' and cmd='UPDATE'
                and qual like '%is_restaurant_member%') $v$),
   (0,'sys','check','restaurant_invites: SELECT so do OWNER','select 1',
    $v$ exists (select 1 from pg_policies where schemaname='public' and tablename='restaurant_invites' and cmd='SELECT'
                and qual like '%is_restaurant_owner%')
        and not exists (select 1 from pg_policies where schemaname='public' and tablename='restaurant_invites'
                and qual like '%is_restaurant_member%') $v$),
   (0,'sys','check','storage: INSERT/UPDATE/DELETE em restaurant-assets so do OWNER','select 1',
    $v$ (select count(*) from pg_policies where schemaname='storage' and tablename='objects'
          and cmd in ('INSERT','UPDATE','DELETE') and coalesce(qual,'') || coalesce(with_check,'') like '%is_restaurant_owner%') = 3
        and not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
          and cmd in ('INSERT','UPDATE','DELETE') and coalesce(qual,'') || coalesce(with_check,'') like '%is_restaurant_member%') $v$);

  foreach tbl in array trig_tables loop
    insert into _cases (phase, persona, expect, label, stmt, verify) values
     (0,'sys','check', format('trigger de guarda ativo em %s (INSERT, UPDATE e DELETE)', tbl), 'select 1',
      format($v$ exists (select 1 from pg_trigger where tgrelid = 'public.%I'::regclass and tgname = 'guard_owner_only_writes'
                  and tgenabled = 'O' and (tgtype & 1) = 1 and (tgtype & 2) = 2 and (tgtype & 4) = 4
                  and (tgtype & 8) = 8 and (tgtype & 16) = 16) $v$, tbl));
  end loop;
  foreach fn in array owner_rpcs loop
    insert into _cases (phase, persona, expect, label, stmt, verify) values
     (0,'sys','check', format('RPC %s exige OWNER (nao membro)', fn), 'select 1',
      format($v$ (select pg_get_functiondef(p.oid) like '%%is_restaurant_owner(%%'
                         and pg_get_functiondef(p.oid) not like '%%is_restaurant_member(%%'
                  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = %L) $v$, fn));
  end loop;
  insert into _cases (phase, persona, expect, label, stmt, verify) values
   (0,'sys','check','RPCs operacionais de pedido continuam exigindo MEMBRO (STAFF opera pedidos)','select 1',
    $v$ (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
          and p.proname in ('advance_order_status','cancel_order')
          and pg_get_functiondef(p.oid) like '%is_restaurant_member(%') = 2 $v$);

  -- ============================================================
  -- FASE 1 — ataques do STAFF da loja A (e controle de leitura)
  -- ============================================================
  -- 1a. escrita direta em configuracao da loja
  insert into _cases (phase, persona, expect, needle, label, stmt) values
   (1,'staff_a','deny',dml_needle,'STAFF NAO troca a chave Pix',          format($s$ update public.restaurants set payment_pix_key = 'hack-pix' where id = %L $s$, r_a)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO troca o titular do Pix',     format($s$ update public.restaurants set payment_pix_holder_name = 'hack' where id = %L $s$, r_a)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO desliga o Pix',              format('update public.restaurants set payment_pix = false where id = %L', r_a)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO pausa a loja (status)',      format($s$ update public.restaurants set status = 'paused' where id = %L $s$, r_a)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO altera a taxa de entrega',   format('update public.restaurants set delivery_fee = 99 where id = %L', r_a)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO altera nome da loja',        format($s$ update public.restaurants set name = 'hack' where id = %L $s$, r_a)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO altera logo/capa',           format($s$ update public.restaurants set logo_path = 'x/y.png', cover_path = 'x/z.png' where id = %L $s$, r_a)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO altera bio/contato',         format($s$ update public.restaurants set bio = 'hack', contact_email = 'h@h.co' where id = %L $s$, r_a)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO altera progresso do onboarding', format('update public.onboarding_progress set current_step = 1 where restaurant_id = %L', r_a)),
   -- cupons, zonas e horarios
   (1,'staff_a','deny',dml_needle,'STAFF NAO cria cupom',                 format($s$ insert into public.coupons (restaurant_id, code, discount_type, discount_value) values (%L, 'HACK100', 'percent', 100) $s$, r_a)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO altera cupom',               format('update public.coupons set discount_value = 100 where id = %L', coupon_a)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO apaga cupom',                format('delete from public.coupons where id = %L', coupon_del)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO cria zona de entrega',       format($s$ insert into public.delivery_zones (restaurant_id, neighborhood, delivery_fee) values (%L, 'Hack', 0) $s$, r_a)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO altera zona de entrega',     format('update public.delivery_zones set delivery_fee = 0 where id = %L', zone_a)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO apaga zona de entrega',      format('delete from public.delivery_zones where id = %L', zone_del)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO cria horario',               format($s$ insert into public.business_hours (restaurant_id, day_of_week, opens_at, closes_at, period_order) values (%L, 1, '03:00', '04:00', 3) $s$, r_a)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO altera horario',             format($s$ update public.business_hours set closes_at = '00:01' where id = %L $s$, hrs_a)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO apaga horario',              format('delete from public.business_hours where id = %L', hrs_del));

  -- 1b. escrita direta no cardapio
  insert into _cases (phase, persona, expect, needle, label, stmt) values
   (1,'staff_a','deny',dml_needle,'STAFF NAO cria categoria',             format($s$ insert into public.categories (restaurant_id, name, display_order) values (%L, 'hack', 1) $s$, r_a)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO renomeia categoria',         format($s$ update public.categories set name = 'hack' where id = %L $s$, cat_a)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO desativa categoria',         format('update public.categories set is_active = false where id = %L', cat_a)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO apaga categoria',            format('delete from public.categories where id = %L', cat_del)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO cria produto',               format($s$ insert into public.products (restaurant_id, name, price, category_id, display_order) values (%L, 'hack', 1, %L, 1) $s$, r_a, cat_a)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO apaga produto',              format('delete from public.products where id = %L', prod_del)),
   (1,'staff_a','deny','owner_required','STAFF NAO renomeia produto',     format($s$ update public.products set name = 'hack' where id = %L $s$, prod_a)),
   (1,'staff_a','deny','owner_required','STAFF NAO altera preco',         format('update public.products set price = 0.01 where id = %L', prod_a)),
   (1,'staff_a','deny','owner_required','STAFF NAO altera custo',         format('update public.products set cost = 0 where id = %L', prod_a)),
   (1,'staff_a','deny','owner_required','STAFF NAO altera descricao',     format($s$ update public.products set description = 'hack' where id = %L $s$, prod_a)),
   (1,'staff_a','deny','owner_required','STAFF NAO muda categoria do produto', format('update public.products set category_id = %L where id = %L', cat_a2, prod_a)),
   (1,'staff_a','deny','owner_required','STAFF NAO reordena produto',     format('update public.products set display_order = 1 where id = %L', prod_a)),
   (1,'staff_a','deny','owner_required','STAFF NAO altera is_available JUNTO com o nome', format($s$ update public.products set is_available = false, name = 'hack' where id = %L $s$, prod_a)),
   (1,'staff_a','deny','owner_required','STAFF NAO altera is_available JUNTO com o preco', format('update public.products set is_available = false, price = 0.01 where id = %L', prod_a)),
   (1,'staff_a','deny','owner_required','STAFF NAO altera is_available JUNTO com o custo', format('update public.products set is_available = false, cost = 0 where id = %L', prod_a)),
   (1,'staff_a','deny','owner_required','STAFF NAO move produto para a loja B (com is_available)', format('update public.products set is_available = false, restaurant_id = %L, category_id = %L where id = %L', r_b, cat_b, prod_a)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO cria adicional',             format($s$ insert into public.addons (restaurant_id, addon_group_id, name, price, display_order) values (%L, %L, 'hack', 0, 1) $s$, r_a, grp_a)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO apaga adicional',            format('delete from public.addons where id = %L', add_del)),
   (1,'staff_a','deny','owner_required','STAFF NAO renomeia adicional',   format($s$ update public.addons set name = 'hack' where id = %L $s$, add_a)),
   (1,'staff_a','deny','owner_required','STAFF NAO altera preco do adicional', format('update public.addons set price = 0 where id = %L', add_a)),
   (1,'staff_a','deny','owner_required','STAFF NAO altera is_available do adicional JUNTO com o preco', format('update public.addons set is_available = false, price = 0 where id = %L', add_a)),
   (1,'staff_a','deny','owner_required','STAFF NAO muda o grupo do adicional', format('update public.addons set addon_group_id = %L where id = %L', grp_del, add_a)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO cria grupo de adicionais',   format($s$ insert into public.addon_groups (restaurant_id, name, display_order) values (%L, 'hack', 1) $s$, r_a)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO desativa grupo de adicionais', format('update public.addon_groups set is_active = false where id = %L', grp_a)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO renomeia grupo de adicionais', format($s$ update public.addon_groups set name = 'hack' where id = %L $s$, grp_a)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO apaga grupo de adicionais',  format('delete from public.addon_groups where id = %L', grp_del)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO cria combo',                 format($s$ insert into public.combos (restaurant_id, name, price, display_order) values (%L, 'hack', 1, 1) $s$, r_a)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO liga/desliga combo (D1: so produto e adicional)', format('update public.combos set is_available = false where id = %L', combo_a)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO altera preco do combo',      format('update public.combos set price = 1 where id = %L', combo_a)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO apaga combo',                format('delete from public.combos where id = %L', combo_del)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO altera itens do combo',      format('update public.combo_items set quantity = 9 where id = %L', citem_a)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO apaga item do combo',        format('delete from public.combo_items where id = %L', citem_del)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO associa grupo de adicionais a produto', format('insert into public.product_addon_groups (restaurant_id, product_id, addon_group_id, display_order) values (%L, %L, %L, 5)', r_a, prod_a2, grp_a)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO remove associacao de grupo', format('delete from public.product_addon_groups where id = %L', pag_del)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO cadastra imagem de produto', format($s$ insert into public.product_images (restaurant_id, product_id, storage_path, display_order) values (%L, %L, %L, 3) $s$, r_a, prod_a, r_a || '/hack.png')),
   (1,'staff_a','deny',dml_needle,'STAFF NAO reordena imagem de produto', format('update public.product_images set display_order = 4 where id = %L', img_a)),
   (1,'staff_a','deny',dml_needle,'STAFF NAO apaga imagem de produto',   format('delete from public.product_images where id = %L', img_del));

  -- 1c. RPCs de cardapio como STAFF (todas exigem OWNER antes de escrever)
  insert into _cases (phase, persona, expect, needle, label, stmt) values
   (1,'staff_a','deny',rpc_needle,'RPC create_category',      format($s$ select public.create_category(%L, 'hack', null) $s$, r_a)),
   (1,'staff_a','deny',rpc_needle,'RPC move_category',        format($s$ select public.move_category(%L, 'up') $s$, cat_a2)),
   (1,'staff_a','deny',rpc_needle,'RPC create_product',       format($s$ select public.create_product(%L, %L, 'hack', null, 1, null, true) $s$, r_a, cat_a)),
   (1,'staff_a','deny',rpc_needle,'RPC update_product (so is_available mudaria)', format($s$ select public.update_product(%L, %L, 'prod-a', 'desc-a', 10, 2.5, false) $s$, prod_a, cat_a)),
   (1,'staff_a','deny',rpc_needle,'RPC update_product (nome + is_available)',     format($s$ select public.update_product(%L, %L, 'hack', 'desc-a', 10, 2.5, false) $s$, prod_a, cat_a)),
   (1,'staff_a','deny',rpc_needle,'RPC move_product',         format($s$ select public.move_product(%L, 'up') $s$, prod_a2)),
   (1,'staff_a','deny',rpc_needle,'RPC move_product_image',   format($s$ select public.move_product_image(%L, 'down') $s$, img_a)),
   (1,'staff_a','deny',rpc_needle,'RPC create_addon_group',   format($s$ select public.create_addon_group(%L, 'hack', null, 0, 1, false) $s$, r_a)),
   (1,'staff_a','deny',rpc_needle,'RPC update_addon_group',   format($s$ select public.update_addon_group(%L, 'hack', null, 0, 1, false) $s$, grp_a)),
   (1,'staff_a','deny',rpc_needle,'RPC move_addon_group',     format($s$ select public.move_addon_group(%L, 'down') $s$, grp_a)),
   (1,'staff_a','deny',rpc_needle,'RPC create_addon',         format($s$ select public.create_addon(%L, %L, 'hack', null, 1, true) $s$, r_a, grp_a)),
   (1,'staff_a','deny',rpc_needle,'RPC update_addon (so is_available mudaria)', format($s$ select public.update_addon(%L, 'add-a', null, 2, false) $s$, add_a)),
   (1,'staff_a','deny',rpc_needle,'RPC move_addon',           format($s$ select public.move_addon(%L, 'down') $s$, add_a)),
   (1,'staff_a','deny',rpc_needle,'RPC add_product_addon_group',  format('select public.add_product_addon_group(%L, %L)', prod_a2, grp_a)),
   (1,'staff_a','deny',rpc_needle,'RPC move_product_addon_group', format($s$ select public.move_product_addon_group(%L, 'down') $s$, pag_a)),
   (1,'staff_a','deny',rpc_needle,'RPC create_combo',         format($s$ select public.create_combo(%L, 'hack', null, 1, true) $s$, r_a)),
   (1,'staff_a','deny',rpc_needle,'RPC update_combo',         format($s$ select public.update_combo(%L, 'hack', null, 1, true) $s$, combo_a)),
   (1,'staff_a','deny',rpc_needle,'RPC move_combo',           format($s$ select public.move_combo(%L, 'down') $s$, combo_a)),
   (1,'staff_a','deny',rpc_needle,'RPC add_combo_item',       format('select public.add_combo_item(%L, %L, 1)', combo_a, prod_a2)),
   (1,'staff_a','deny',rpc_needle,'RPC update_combo_item',    format('select public.update_combo_item(%L, 5)', citem_a)),
   (1,'staff_a','deny',rpc_needle,'RPC move_combo_item',      format($s$ select public.move_combo_item(%L, 'down') $s$, citem_a));

  -- 1c2. RPC SECURITY DEFINER legada: ignora a RLS; so o trigger de guarda protege
  insert into _cases (phase, persona, expect, needle, label, stmt) values
   (1,'staff_a','deny','owner_required','DEFINER sem checagem: STAFF NAO muda o nome junto de is_available',  format($s$ select public._roles_t_legacy('rename_and_toggle_product', %L, null) $s$, prod_a)),
   (1,'staff_a','deny','owner_required','DEFINER sem checagem: STAFF NAO liga/desliga combo',                  format($s$ select public._roles_t_legacy('toggle_combo', %L, null) $s$, combo_a)),
   (1,'staff_a','deny','owner_required','DEFINER sem checagem: STAFF NAO desativa grupo de adicionais',        format($s$ select public._roles_t_legacy('toggle_addon_group', %L, null) $s$, grp_a)),
   (1,'staff_a','deny','owner_required','DEFINER sem checagem: STAFF NAO apaga produto',                       format($s$ select public._roles_t_legacy('delete_product', %L, null) $s$, prod_del)),
   (1,'staff_a','deny','owner_required','DEFINER sem checagem: STAFF NAO cria categoria',                      format($s$ select public._roles_t_legacy('insert_category', null, %L) $s$, r_a)),
   (1,'staff_a','deny','owner_required','DEFINER sem checagem: STAFF NAO move produto para a loja B',          format($s$ select public._roles_t_legacy('move_product_to_b', %L, %L) $s$, prod_a, r_b));

  -- 1d. equipe, convites e arquivos
  insert into _cases (phase, persona, expect, needle, want, label, stmt) values
   (1,'staff_a','count',null,0,'STAFF NAO le convites (token do convite)',           format('select count(*) from public.restaurant_invites where restaurant_id = %L', r_a)),
   (1,'staff_a','count',null,0,'STAFF NAO le o token dos convites (consulta por coluna)', format('select count(token) from public.restaurant_invites where id = %L', inv_a)),
   (1,'staff_a','deny',rpc_needle,null,'STAFF NAO cria convite',             $s$ select public.create_restaurant_invite('hack@roles.test') $s$),
   (1,'staff_a','deny',rpc_needle,null,'STAFF NAO revoga convite',           format('select public.revoke_restaurant_invite(%L)', inv_a)),
   (1,'staff_a','deny',rpc_needle,null,'STAFF NAO reenvia convite',          format('select public.resend_restaurant_invite(%L)', inv_a)),
   (1,'staff_a','deny',rpc_needle,null,'STAFF NAO remove membro',            format('select public.remove_restaurant_member(%L)', mem_staff)),
   (1,'staff_a','deny',dml_needle,null,'STAFF NAO se promove (update de role)', format($s$ update public.restaurant_members set role = 'OWNER' where id = %L $s$, mem_staff)),
   (1,'staff_a','deny',dml_needle,null,'STAFF NAO cria convite por INSERT direto', format($s$ insert into public.restaurant_invites (restaurant_id, email, role, invited_by) values (%L, 'h@h.co', 'STAFF', %L) $s$, r_a, u_staff_a)),
   (1,'staff_a','deny',dml_needle,null,'STAFF NAO envia arquivo para a loja (storage insert)', format($s$ insert into storage.objects (bucket_id, name) values ('restaurant-assets', %L) $s$, r_a || '/hack.png')),
   (1,'staff_a','deny',dml_needle,null,'STAFF NAO sobrescreve arquivo da loja (storage update)', format($s$ update storage.objects set name = name where bucket_id = 'restaurant-assets' and name = %L $s$, obj_a)),
   (1,'staff_a','deny',dml_needle,null,'STAFF NAO apaga arquivo da loja (storage delete)', format($s$ delete from storage.objects where bucket_id = 'restaurant-assets' and name = %L $s$, obj_del));

  -- 1e. nada acima mudou (verificado como dono do banco)
  insert into _cases (phase, persona, expect, label, stmt, verify) values
   (1,'sys','check','apos os ataques: configuracao da loja A intacta','select 1',
    format($v$ (select payment_pix_key = 'pix-original@roles.test' and payment_pix = true and status = 'active'
                       and delivery_fee = 5 and name = 'Loja A' and bio = 'bio-original' and logo_path is null
                from public.restaurants where id = %L) $v$, r_a)),
   (1,'sys','check','apos os ataques: produto e adicional intactos (nome, preco, custo, disponibilidade, loja)','select 1',
    format($v$ (select name = 'prod-a' and price = 10 and cost = 2.5 and is_available and description = 'desc-a'
                       and category_id = %L and restaurant_id = %L and display_order = 9001
                from public.products where id = %L)
             and (select name = 'add-a' and price = 2 and is_available and addon_group_id = %L from public.addons where id = %L) $v$,
           cat_a, r_a, prod_a, grp_a, add_a)),
   (1,'sys','check','apos os ataques: nada foi apagado nem criado por STAFF','select 1',
    format($v$ (select count(*) from public.products where restaurant_id = %L) = 3
             and (select count(*) from public.categories where restaurant_id = %L) = 3
             and (select count(*) from public.addons where restaurant_id = %L) = 3
             and (select count(*) from public.addon_groups where restaurant_id = %L) = 2
             and (select count(*) from public.combos where restaurant_id = %L) = 2
             and (select count(*) from public.combo_items where restaurant_id = %L) = 2
             and (select count(*) from public.product_addon_groups where restaurant_id = %L) = 2
             and (select count(*) from public.product_images where restaurant_id = %L) = 2
             and (select count(*) from public.coupons where restaurant_id = %L) = 2
             and (select count(*) from public.delivery_zones where restaurant_id = %L) = 2
             and (select count(*) from public.business_hours where restaurant_id = %L) = 8
             and (select count(*) from public.restaurant_invites where restaurant_id = %L) = 1
             and (select count(*) from storage.objects where bucket_id = 'restaurant-assets' and name like %L) = 2
             and (select role from public.restaurant_members where id = %L) = 'STAFF' $v$,
           r_a, r_a, r_a, r_a, r_a, r_a, r_a, r_a, r_a, r_a, r_a, r_a, r_a || '/%', mem_staff)),
   (1,'sys','check','apos os ataques: progresso do onboarding intacto (a linha existe e nao mudou)','select 1',
    format($v$ (select current_step = 2 from public.onboarding_progress where restaurant_id = %L) $v$, r_a)),
   (1,'sys','check','apos os ataques: a loja B nao foi tocada','select 1',
    format($v$ (select name = 'prod-b' and is_available from public.products where id = %L)
             and (select restaurant_id = %L from public.products where id = %L) $v$, prod_b, r_b, prod_b));

  -- ============================================================
  -- FASE 2 — controles do STAFF (operacao legitima) e regras de pedidos (D3)
  -- ============================================================
  insert into _cases (phase, persona, expect, label, stmt, verify, want) values
   (2,'staff_a','count','CONTROLE: STAFF le produtos da propria loja',   format('select count(*) from public.products where restaurant_id = %L', r_a), null, 3),
   (2,'staff_a','count','CONTROLE: STAFF le pedidos da propria loja',    format('select count(*) from public.orders where restaurant_id = %L', r_a), null, 3),
   (2,'staff_a','count','CONTROLE: STAFF le a propria loja',             format('select count(*) from public.restaurants where id = %L', r_a), null, 1),
   (2,'staff_a','count','STAFF NAO le produtos da loja B',               format('select count(*) from public.products where restaurant_id = %L', r_b), null, 0),
   (2,'staff_a','count','STAFF NAO le pedidos da loja B',                format('select count(*) from public.orders where restaurant_id = %L', r_b), null, 0);

  insert into _cases (phase, persona, expect, label, stmt, verify) values
   (2,'staff_a','allow','CONTROLE: STAFF desliga a disponibilidade do produto',
    format('update public.products set is_available = false where id = %L', prod_a),
    format($v$ (select not is_available and name = 'prod-a' and price = 10 and cost = 2.5 and description = 'desc-a'
                       and category_id = %L and display_order = 9001 and updated_at > '2020-01-01'::timestamptz
                from public.products where id = %L) $v$, cat_a, prod_a)),
   (2,'staff_a','allow','CONTROLE: STAFF religa a disponibilidade do produto',
    format('update public.products set is_available = true where id = %L', prod_a),
    format($v$ (select is_available and name = 'prod-a' from public.products where id = %L) $v$, prod_a)),
   (2,'staff_a','allow','CONTROLE: STAFF desliga a disponibilidade do adicional',
    format('update public.addons set is_available = false where id = %L', add_a),
    format($v$ (select not is_available and name = 'add-a' and price = 2 and addon_group_id = %L and updated_at > '2020-01-01'::timestamptz
                from public.addons where id = %L) $v$, grp_a, add_a)),
   (2,'staff_a','allow','CONTROLE: STAFF repete is_available reenviando as outras colunas SEM mudar (como o PostgREST faria com o objeto inteiro)',
    format($s$ update public.products set is_available = false, name = 'prod-a2', price = 12 where id = %L $s$, prod_a2),
    format($v$ (select not is_available and name = 'prod-a2' and price = 12 from public.products where id = %L) $v$, prod_a2)),
   (2,'staff_a','allow','CONTROLE: STAFF liga/desliga em lote (varios produtos da loja)',
    format('update public.products set is_available = true where restaurant_id = %L', r_a),
    format($v$ (select bool_and(is_available) from public.products where restaurant_id = %L) $v$, r_a)),
   (2,'staff_a','allow','CONTROLE: via funcao DEFINER sem checagem, STAFF ainda so consegue ligar/desligar is_available (nada mais muda)',
    format($s$ select public._roles_t_legacy('toggle_product', %L, null) $s$, prod_a2),
    format($v$ (select not is_available and name = 'prod-a2' and price = 12 from public.products where id = %L) $v$, prod_a2)),
   (2,'staff_a','allow','CONTROLE: STAFF avanca pedido da propria loja (received -> confirmed)',
    format('select public.advance_order_status(%L)', ord_a),
    format($v$ (select status = 'confirmed' from public.orders where id = %L) $v$, ord_a)),
   (2,'staff_a','allow','CONTROLE: STAFF cancela pedido em andamento da propria loja',
    format($s$ select public.cancel_order(%L, 'cliente desistiu') $s$, ord_cancel),
    format($v$ (select status = 'cancelled' from public.orders where id = %L)
              and (select count(*) from public.order_status_history where order_id = %L and changed_by = %L and reason = 'cliente desistiu') = 1 $v$,
           ord_cancel, ord_cancel, u_staff_a));

  insert into _cases (phase, persona, expect, needle, label, stmt, verify) values
   (2,'staff_a','deny','not_authorized','STAFF NAO avanca pedido da loja B',      format('select public.advance_order_status(%L)', ord_b), null),
   (2,'staff_a','deny','not_authorized','STAFF NAO cancela pedido da loja B',     format($s$ select public.cancel_order(%L, 'hack') $s$, ord_b),
    format($v$ (select status = 'received' from public.orders where id = %L) $v$, ord_b)),
   (2,'staff_a','deny','invalid_transition','STAFF NAO avanca pedido ja retirado/entregue (estado terminal)', format('select public.advance_order_status(%L)', ord_done), null),
   (2,'staff_a','deny','invalid_transition','STAFF NAO cancela pedido ja retirado/entregue', format($s$ select public.cancel_order(%L, 'hack') $s$, ord_done),
    format($v$ (select status = 'picked_up' from public.orders where id = %L) $v$, ord_done)),
   (2,'staff_a','deny','invalid_transition','STAFF NAO cancela pedido ja cancelado', format($s$ select public.cancel_order(%L, 'hack') $s$, ord_cancel), null),
   (2,'staff_a','deny','invalid_reason','STAFF NAO cancela sem motivo',           format($s$ select public.cancel_order(%L, '   ') $s$, ord_a), null),
   (2,'staff_a','deny',dml_needle,'STAFF NAO altera pedido por UPDATE direto (pula a RPC)', format($s$ update public.orders set status = 'delivered' where id = %L $s$, ord_a),
    format($v$ (select status = 'confirmed' from public.orders where id = %L) $v$, ord_a)),
   (2,'staff_a','deny',dml_needle,'STAFF NAO apaga pedido',                       format('delete from public.orders where id = %L', ord_a), null),
   (2,'staff_a','deny',dml_needle,'STAFF NAO forja historico de status',          format($s$ insert into public.order_status_history (restaurant_id, order_id, from_status, to_status, changed_by) values (%L, %L, 'received', 'delivered', %L) $s$, r_a, ord_a, u_staff_a), null);

  -- ============================================================
  -- FASE 3 — OWNER continua podendo tudo (controles positivos)
  -- ============================================================
  insert into _cases (phase, persona, expect, label, stmt, verify, want) values
   (3,'owner_a','allow','OWNER troca a chave Pix',          format($s$ update public.restaurants set payment_pix_key = 'novo-pix@roles.test' where id = %L $s$, r_a),
    format($v$ (select payment_pix_key = 'novo-pix@roles.test' from public.restaurants where id = %L) $v$, r_a), null),
   (3,'owner_a','allow','OWNER pausa a loja',               format($s$ update public.restaurants set status = 'paused' where id = %L $s$, r_a),
    format($v$ (select status = 'paused' from public.restaurants where id = %L) $v$, r_a), null),
   (3,'owner_a','allow','OWNER reabre a loja',              format($s$ update public.restaurants set status = 'active' where id = %L $s$, r_a),
    format($v$ (select status = 'active' from public.restaurants where id = %L) $v$, r_a), null),
   (3,'owner_a','allow','OWNER altera onboarding_progress', format('update public.onboarding_progress set current_step = current_step where restaurant_id = %L', r_a), null, null),
   (3,'owner_a','allow','OWNER cria cupom',                 format($s$ insert into public.coupons (restaurant_id, code, discount_type, discount_value) values (%L, 'OWNERCUP', 'fixed', 2) $s$, r_a), null, null),
   (3,'owner_a','allow','OWNER altera cupom',               format('update public.coupons set discount_value = 15 where id = %L', coupon_a), null, null),
   (3,'owner_a','allow','OWNER apaga cupom',                format('delete from public.coupons where id = %L', coupon_del), null, null),
   (3,'owner_a','allow','OWNER cria zona',                  format($s$ insert into public.delivery_zones (restaurant_id, neighborhood, delivery_fee) values (%L, 'Novo', 4) $s$, r_a), null, null),
   (3,'owner_a','allow','OWNER altera zona',                format('update public.delivery_zones set delivery_fee = 6 where id = %L', zone_a), null, null),
   (3,'owner_a','allow','OWNER apaga zona',                 format('delete from public.delivery_zones where id = %L', zone_del), null, null),
   (3,'owner_a','allow','OWNER apaga horario extra',        format('delete from public.business_hours where id = %L', hrs_del), null, null),
   (3,'owner_a','allow','OWNER cria categoria (RPC)',       format($s$ select public.create_category(%L, 'owner-cat', null) $s$, r_a), null, null),
   (3,'owner_a','allow','OWNER move categoria (RPC)',       format($s$ select public.move_category(%L, 'down') $s$, cat_a), null, null),
   (3,'owner_a','allow','OWNER cria produto (RPC)',         format($s$ select public.create_product(%L, %L, 'owner-prod', null, 9.9, 1, true) $s$, r_a, cat_a), null, null),
   (3,'owner_a','allow','OWNER edita produto (RPC)',        format($s$ select public.update_product(%L, %L, 'prod-a-ed', 'desc-a', 11, 2.5, true) $s$, prod_a, cat_a),
    format($v$ (select name = 'prod-a-ed' and price = 11 from public.products where id = %L) $v$, prod_a), null),
   (3,'owner_a','allow','OWNER move produto (RPC)',         format($s$ select public.move_product(%L, 'down') $s$, prod_a), null, null),
   (3,'owner_a','allow','OWNER altera preco por UPDATE direto', format('update public.products set price = 12.5 where id = %L', prod_a),
    format($v$ (select price = 12.5 from public.products where id = %L) $v$, prod_a), null),
   (3,'owner_a','allow','OWNER apaga produto',             format('delete from public.products where id = %L', prod_del), null, null),
   (3,'owner_a','allow','OWNER cria grupo de adicionais (RPC)', format($s$ select public.create_addon_group(%L, 'owner-grp', null, 0, 1, false) $s$, r_a), null, null),
   (3,'owner_a','allow','OWNER edita grupo de adicionais (RPC)', format($s$ select public.update_addon_group(%L, 'grp-a-ed', null, 0, 1, false) $s$, grp_a), null, null),
   (3,'owner_a','allow','OWNER cria adicional (RPC)',      format($s$ select public.create_addon(%L, %L, 'owner-add', null, 1, true) $s$, r_a, grp_a), null, null),
   (3,'owner_a','allow','OWNER edita adicional (RPC)',     format($s$ select public.update_addon(%L, 'add-a-ed', null, 2.5, true) $s$, add_a), null, null),
   (3,'owner_a','allow','OWNER move adicional (RPC)',      format($s$ select public.move_addon(%L, 'down') $s$, add_a), null, null),
   (3,'owner_a','allow','OWNER apaga adicional',           format('delete from public.addons where id = %L', add_del), null, null),
   (3,'owner_a','allow','OWNER associa grupo a produto (RPC)', format('select public.add_product_addon_group(%L, %L)', prod_a2, grp_a), null, null),
   (3,'owner_a','allow','OWNER move associacao (RPC)',     format($s$ select public.move_product_addon_group(%L, 'down') $s$, pag_a), null, null),
   (3,'owner_a','allow','OWNER cria combo (RPC)',          format($s$ select public.create_combo(%L, 'owner-combo', null, 20, true) $s$, r_a), null, null),
   (3,'owner_a','allow','OWNER edita combo (RPC)',         format($s$ select public.update_combo(%L, 'combo-a-ed', null, 31, true) $s$, combo_a), null, null),
   (3,'owner_a','allow','OWNER adiciona item ao combo (RPC)', format('select public.add_combo_item(%L, %L, 2)', combo_a, prod_a2), null, null),
   (3,'owner_a','allow','OWNER altera item do combo (RPC)', format('select public.update_combo_item(%L, 3)', citem_a), null, null),
   (3,'owner_a','allow','OWNER move item do combo (RPC)', format($s$ select public.move_combo_item(%L, 'down') $s$, citem_a), null, null),
   (3,'owner_a','allow','OWNER apaga combo',               format('delete from public.combos where id = %L', combo_del), null, null),
   (3,'owner_a','allow','OWNER move imagem de produto (RPC)', format($s$ select public.move_product_image(%L, 'down') $s$, img_a), null, null),
   (3,'owner_a','allow','OWNER apaga imagem de produto',   format('delete from public.product_images where id = %L', img_del), null, null),
   (3,'owner_a','allow','OWNER envia arquivo da loja (storage insert)', format($s$ insert into storage.objects (bucket_id, name) values ('restaurant-assets', %L) $s$, r_a || '/owner-up.png'), null, null),
   (3,'owner_a','allow','OWNER apaga arquivo da loja (storage delete)', format($s$ delete from storage.objects where bucket_id = 'restaurant-assets' and name = %L $s$, obj_del), null, null),
   (3,'owner_a','count','OWNER le os convites da propria loja', format('select count(*) from public.restaurant_invites where restaurant_id = %L', r_a), null, 1),
   (3,'owner_a','allow','OWNER cria convite (RPC)',        $s$ select public.create_restaurant_invite('novo2@roles.test') $s$, null, null),
   (3,'owner_a','allow','OWNER revoga convite (RPC)',      format('select public.revoke_restaurant_invite(%L)', inv_a), null, null);

  insert into _cases (phase, persona, expect, needle, label, stmt) values
   (3,'owner_a','deny',dml_needle,'OWNER da loja A NAO move produto para a loja B', format('update public.products set restaurant_id = %L, category_id = %L where id = %L', r_b, cat_b, prod_a)),
   (3,'owner_a','deny',dml_needle,'OWNER da loja A NAO apaga produto da loja B',   format('delete from public.products where id = %L', prod_b)),
   (3,'owner_a','deny',dml_needle,'OWNER da loja A NAO altera cupom/zona da loja B', format($s$ insert into public.coupons (restaurant_id, code, discount_type, discount_value) values (%L, 'CROSSB', 'fixed', 1) $s$, r_b)),
   (3,'owner_a','deny',dml_needle,'OWNER da loja A NAO envia arquivo para a pasta da loja B', format($s$ insert into storage.objects (bucket_id, name) values ('restaurant-assets', %L) $s$, r_b || '/hack.png')),
   (3,'owner_a','deny',rpc_needle,'OWNER da loja A NAO cria produto na loja B (RPC)', format($s$ select public.create_product(%L, %L, 'hack', null, 1, null, true) $s$, r_b, cat_b));

  -- ============================================================
  -- FASE 4 — outras personas
  -- ============================================================
  insert into _cases (phase, persona, expect, needle, label, stmt) values
   (4,'owner_b','deny',dml_needle,'OWNER da loja B NAO altera a loja A',           format($s$ update public.restaurants set name = 'hack' where id = %L $s$, r_a)),
   (4,'owner_b','deny',dml_needle,'OWNER da loja B NAO altera produto da loja A',   format($s$ update public.products set name = 'hack' where id = %L $s$, prod_a2)),
   (4,'owner_b','deny',dml_needle,'OWNER da loja B NAO liga/desliga produto da loja A', format('update public.products set is_available = false where id = %L', prod_a2)),
   (4,'owner_b','deny',rpc_needle,'OWNER da loja B NAO usa RPC de cardapio na loja A', format($s$ select public.create_category(%L, 'hack', null) $s$, r_a)),
   (4,'master','deny',dml_needle,'master NAO altera a loja A por UPDATE direto',    format($s$ update public.restaurants set name = 'hack' where id = %L $s$, r_a)),
   (4,'master','deny',dml_needle,'master NAO altera produto da loja A',            format($s$ update public.products set name = 'hack' where id = %L $s$, prod_a2)),
   (4,'master','deny',dml_needle,'master NAO liga/desliga produto da loja A',      format('update public.products set is_available = false where id = %L', prod_a2)),
   (4,'master','deny',rpc_needle,'master NAO usa RPC de cardapio na loja A',        format($s$ select public.create_category(%L, 'hack', null) $s$, r_a)),
   (4,'stranger','deny',dml_needle,'sem loja NAO liga/desliga produto da loja A',  format('update public.products set is_available = false where id = %L', prod_a2)),
   (4,'stranger','deny',dml_needle,'sem loja NAO altera a loja A',                 format($s$ update public.restaurants set name = 'hack' where id = %L $s$, r_a)),
   (4,'anon','deny',dml_needle,'anon NAO liga/desliga produto',                    format('update public.products set is_available = false where id = %L', prod_a2)),
   (4,'anon','deny',dml_needle,'anon NAO altera a loja A',                         format($s$ update public.restaurants set name = 'hack' where id = %L $s$, r_a)),
   (4,'anon','deny',dml_needle,'anon NAO cria cupom',                              format($s$ insert into public.coupons (restaurant_id, code, discount_type, discount_value) values (%L, 'ANONHACK', 'fixed', 1) $s$, r_a));

  insert into _cases (phase, persona, expect, label, stmt, verify) values
   (4,'service','allow','CONTROLE: service_role (backend) altera a loja sem restricao de papel',
    format($s$ update public.restaurants set bio = 'service-ok' where id = %L $s$, r_a),
    format($v$ (select bio = 'service-ok' from public.restaurants where id = %L) $v$, r_a)),
   (4,'service','allow','CONTROLE: service_role altera produto (sem JWT de usuario o guarda nao interfere)',
    format($s$ update public.products set name = 'prod-a2-service' where id = %L $s$, prod_a2),
    format($v$ (select name = 'prod-a2-service' from public.products where id = %L) $v$, prod_a2)),
   (4,'sys','allow','CONTROLE: dono do banco (migrations/SQL Editor) altera produto',
    format($s$ update public.products set name = 'prod-a2' where id = %L $s$, prod_a2),
    format($v$ (select name = 'prod-a2' from public.products where id = %L) $v$, prod_a2));

  -- ============================================================
  -- FASE 5 — checkout publico, cupom e venda de balcao (nao podem quebrar)
  -- ============================================================
  insert into _cases (phase, persona, expect, label, stmt, verify) values
   (5,'anon','allow','CHECKOUT: anon cria pedido com cupom (create_order escreve em coupons como SECURITY DEFINER)',
    format($s$ select * from public.create_order(%L, 'Cliente', '11988887777', 'pickup', 'cash', %L::jsonb, 'roles-co-1', null, null, null, null, null, null, null, null, null, null, null, 'ROLES10') $s$,
           slug_a, jsonb_build_array(jsonb_build_object('product_id', prod_a, 'quantity', 1))::text),
    format($v$ (select uses_count = 1 from public.coupons where id = %L) $v$, coupon_a)),
   (5,'staff_a','allow','CHECKOUT: STAFF logado tambem compra na propria loja usando cupom (nao pode ser barrado pelo guarda)',
    format($s$ select * from public.create_order(%L, 'Funcionario', '11977776666', 'pickup', 'cash', %L::jsonb, 'roles-co-2', null, null, null, null, null, null, null, null, null, null, null, 'ROLES10') $s$,
           slug_a, jsonb_build_array(jsonb_build_object('product_id', prod_a, 'quantity', 1))::text),
    format($v$ (select uses_count = 2 from public.coupons where id = %L) $v$, coupon_a)),
   (5,'staff_a','allow','VENDA DE BALCAO: STAFF registra venda de balcao da propria loja',
    format($s$ select * from public.create_order(%L, 'Balcao', '11966665555', 'counter', 'cash', %L::jsonb, 'roles-co-3') $s$,
           slug_a, jsonb_build_array(jsonb_build_object('product_id', prod_a, 'quantity', 1))::text),
    format($v$ (select count(*) from public.orders where restaurant_id = %L and idempotency_key = 'roles-co-3') = 1 $v$, r_a)),
   (5,'owner_a','allow','VENDA DE BALCAO: OWNER registra venda de balcao',
    format($s$ select * from public.create_order(%L, 'Balcao', '11955554444', 'counter', 'cash', %L::jsonb, 'roles-co-4') $s$,
           slug_a, jsonb_build_array(jsonb_build_object('product_id', prod_a, 'quantity', 1))::text), null);
  insert into _cases (phase, persona, expect, label, stmt, verify) values
   (5,'staff_a','allow','STAFF desliga a disponibilidade do produto no balcao',
    format('update public.products set is_available = false where id = %L', prod_a2),
    format($v$ (select not is_available from public.products where id = %L) $v$, prod_a2));
  insert into _cases (phase, persona, expect, needle, label, stmt) values
   (5,'anon','deny','product_unavailable','CHECKOUT: produto desligado pelo STAFF e recusado ao cliente',
    format($s$ select * from public.create_order(%L, 'Cliente', '11988887777', 'pickup', 'cash', %L::jsonb, 'roles-co-5') $s$,
           slug_a, jsonb_build_array(jsonb_build_object('product_id', prod_a2, 'quantity', 1))::text));

  -- ---------- execucao ----------
  for v_phase in 0..5 loop
    for c in select * from _cases where phase = v_phase order by ord loop
      total := total + 1;
      reset role;
      if c.persona not in ('sys') then
        perform set_config('request.jwt.claims',
          case c.persona
            when 'anon' then ''
            when 'service' then json_build_object('role', 'service_role')::text
            else json_build_object('sub',
              case c.persona when 'owner_a' then u_owner_a when 'staff_a' then u_staff_a
                             when 'owner_b' then u_owner_b when 'master' then u_master else u_stranger end,
              'role', 'authenticated')::text end, true);
        execute format('set local role %I', case c.persona when 'anon' then 'anon'
                                                       when 'service' then 'service_role' else 'authenticated' end);
      end if;

      if c.expect = 'count' then
        err := null; n := 0;
        begin
          execute c.stmt into n;
        exception when others then
          err := sqlerrm; n := 0;
        end;
        reset role;
        if n is distinct from c.want then
          fails := fails || format('%s (viu %s, esperado %s%s)', c.label, n, c.want, coalesce('; erro: ' || err, ''));
        end if;
      elsif c.expect in ('allow', 'deny') then
        ok := false; err := null; n := 0;
        begin
          execute c.stmt;
          get diagnostics n = row_count;
          ok := n > 0;
        exception when others then
          ok := false; err := sqlerrm;
        end;
        reset role;
        if c.expect = 'allow' then
          if not ok then
            fails := fails || format('%s (foi negado: %s)', c.label, coalesce(err, '0 linhas afetadas'));
          end if;
        else
          if err is null then
            if ok then
              fails := fails || format('%s (FOI PERMITIDO)', c.label);
            elsif c.needle is not null and c.stmt ~* '^\s*select' then
              fails := fails || format('%s (executou sem erro e sem linhas)', c.label);
            end if;
            -- DML sem erro e 0 linhas = filtrado por RLS: negado, aceito como barrado
          elsif c.needle is not null and err !~* c.needle then
            fails := fails || format('%s (barrado por outro motivo, inconclusivo: %s)', c.label, err);
          end if;
        end if;
      else
        reset role;
      end if;

      if c.verify is not null then
        reset role;
        begin
          execute 'select coalesce((' || c.verify || '), false)' into v_ok;
        exception when others then
          v_ok := false;
          fails := fails || format('%s (verificacao com erro: %s)', c.label, sqlerrm);
        end;
        if not v_ok then
          fails := fails || format('%s (verificacao FALHOU)', c.label);
        end if;
      end if;
    end loop;
  end loop;
  reset role;

  if array_length(fails, 1) is null then
    raise exception 'RESULTADO: OK | % verificacoes | notas: %', total, coalesce(array_to_string(notes, ' ; '), '-');
  else
    raise exception 'RESULTADO: FALHOU (%) | % verificacoes | %  || notas: %', array_length(fails, 1), total,
      array_to_string(fails, ' ## '), coalesce(array_to_string(notes, ' ; '), '-');
  end if;
end $$;

-- P1-02 — papéis OWNER/STAFF aplicados no banco (não só nas páginas).
--
-- Regras (decisão do produto):
--   * OWNER:  tudo o que já fazia.
--   * STAFF:  opera pedidos (ver, avançar, cancelar, venda de balcão) e liga/desliga a
--             DISPONIBILIDADE de produtos e adicionais. Nada mais: cadastro, edição,
--             exclusão, preços, categorias, combos, cupons, zonas, horários, pagamentos
--             (chave Pix), aparência, informações, pausar/reabrir a loja, convites,
--             arquivos da loja.
--
-- Camadas (nenhuma depende do frontend):
--   1. is_restaurant_owner(): função de papel, no mesmo molde de is_restaurant_member().
--   2. RLS: escrita só do OWNER nas tabelas de configuração e de cardápio.
--   3. Trigger de guarda nas tabelas de cardápio: vale também para as RPCs SECURITY
--      DEFINER (que ignoram RLS). STAFF só passa em UPDATE de products/addons quando
--      NENHUMA coluna além de is_available (e updated_at) muda.
--   4. RPCs de cardápio exigem OWNER explicitamente (not_authorized antes de qualquer escrita).
--   5. restaurant_invites (tem o token do convite) só é legível pelo OWNER.
--   6. Storage (logo, capa, fotos): escrita só do OWNER.
--
-- O que NÃO muda: leitura por qualquer membro, pedidos (advance_order_status e cancel_order
-- seguem exigindo membro da loja do pedido), checkout público (create_order escreve em
-- coupons.uses_count como SECURITY DEFINER e coupons NÃO tem trigger), service_role e
-- chamadas sem JWT (migrations, SQL Editor, backend).
--
-- Independente da migration de cobrança (P1-01): não toca em nenhum objeto dela; pode ser
-- aplicada antes ou depois.

-- ------------------------------------------------------------------ 1. função de papel
create or replace function public.is_restaurant_owner(target_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.restaurant_members m
    where m.restaurant_id = target_restaurant_id
      and m.user_id = auth.uid()
      and m.role = 'OWNER'
  );
$$;

revoke all on function public.is_restaurant_owner(uuid) from public, anon;
grant execute on function public.is_restaurant_owner(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------ 2. RLS por papel
-- Escrita direta (PostgREST) só do OWNER. Leitura (SELECT) não muda.
do $$
declare
  t text;
begin
  -- INSERT, UPDATE e DELETE só do OWNER.
  foreach t in array array[
    'coupons', 'delivery_zones', 'business_hours', 'categories', 'addon_groups',
    'combos', 'combo_items', 'product_addon_groups', 'product_images'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_insert_members', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_members', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_members', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_owner', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_owner', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_owner', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_restaurant_owner(restaurant_id))', t || '_insert_owner', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_restaurant_owner(restaurant_id)) with check (public.is_restaurant_owner(restaurant_id))', t || '_update_owner', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_restaurant_owner(restaurant_id))', t || '_delete_owner', t);
  end loop;

  -- products e addons: INSERT e DELETE só do OWNER. O UPDATE continua visível ao membro
  -- (STAFF liga/desliga disponibilidade); o trigger do item 3 limita o que STAFF muda.
  foreach t in array array['products', 'addons'] loop
    execute format('drop policy if exists %I on public.%I', t || '_insert_members', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_members', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_owner', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_owner', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_restaurant_owner(restaurant_id))', t || '_insert_owner', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_restaurant_owner(restaurant_id))', t || '_delete_owner', t);
  end loop;
end $$;

-- restaurants: só o OWNER altera a loja (pausar/reabrir, Pix, endereço, delivery...).
-- As colunas de cobrança continuam protegidas por privilégio de coluna + trigger (P0-01).
drop policy if exists restaurants_update_members on public.restaurants;
drop policy if exists restaurants_update_owner on public.restaurants;
create policy restaurants_update_owner on public.restaurants
  for update to authenticated
  using (public.is_restaurant_owner(id))
  with check (public.is_restaurant_owner(id));

-- progresso do onboarding: só o OWNER.
drop policy if exists onboarding_progress_update_members on public.onboarding_progress;
drop policy if exists onboarding_progress_update_owner on public.onboarding_progress;
create policy onboarding_progress_update_owner on public.onboarding_progress
  for update to authenticated
  using (public.is_restaurant_owner(restaurant_id))
  with check (public.is_restaurant_owner(restaurant_id));

-- ------------------------------------------------------------------ 3. trigger de guarda
-- Roda como o chamador de verdade (auth.uid() vem do JWT, não do dono da função), então
-- vale igualmente para escrita direta e para RPC SECURITY DEFINER.
create or replace function public.guard_owner_only_writes()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_restaurant uuid;
  v_old_restaurant uuid;
  v_new_restaurant uuid;
  v_role text;
  v_old jsonb;
  v_new jsonb;
begin
  -- Sem JWT (service_role, migrations, SQL Editor, backend): fora do escopo deste guarda.
  if v_uid is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op <> 'INSERT' then
    v_old_restaurant := old.restaurant_id;
  end if;
  if tg_op <> 'DELETE' then
    v_new_restaurant := new.restaurant_id;
  end if;

  -- Toda loja tocada pela operação (UPDATE pode mudar restaurant_id) precisa ser do OWNER.
  for v_restaurant in
    select distinct x from unnest(array[v_old_restaurant, v_new_restaurant]) as x where x is not null
  loop
    select m.role into v_role
    from public.restaurant_members m
    where m.restaurant_id = v_restaurant and m.user_id = v_uid;

    if v_role is not distinct from 'OWNER' then
      continue;
    end if;

    -- Única exceção: STAFF liga/desliga disponibilidade de produto ou adicional, sem mudar
    -- NENHUMA outra coluna (nem restaurant_id).
    if tg_op = 'UPDATE'
       and v_role = 'STAFF'
       and tg_table_name in ('products', 'addons') then
      -- restaurant_id entra na comparacao: mover a linha para outra loja nunca passa.
      v_old := to_jsonb(old) - 'is_available' - 'updated_at';
      v_new := to_jsonb(new) - 'is_available' - 'updated_at';
      if v_old = v_new then
        continue;
      end if;
    end if;

    raise exception 'owner_required: apenas o proprietario (OWNER) da loja pode alterar %', tg_table_name
      using errcode = '42501';
  end loop;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.guard_owner_only_writes() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'products', 'categories', 'addon_groups', 'addons', 'combos', 'combo_items',
    'product_addon_groups', 'product_images'
  ] loop
    execute format('drop trigger if exists guard_owner_only_writes on public.%I', t);
    -- O nome ordena antes de set_updated_at; a comparação ignora updated_at de qualquer forma.
    execute format('create trigger guard_owner_only_writes before insert or update or delete on public.%I for each row execute function public.guard_owner_only_writes()', t);
  end loop;
end $$;

-- ------------------------------------------------------------------ 4. RPCs de cardápio exigem OWNER
-- Troca is_restaurant_member( por is_restaurant_owner( no corpo de cada RPC de cardápio,
-- preservando o restante da definição (ACL, search_path e SECURITY DEFINER são mantidos por
-- CREATE OR REPLACE). Falha a migration inteira se alguma função mudou e não bate.
do $$
declare
  fn text;
  def text;
  patched text;
begin
  foreach fn in array array[
    'create_category', 'move_category',
    'create_product', 'update_product', 'move_product', 'move_product_image',
    'create_addon_group', 'update_addon_group', 'move_addon_group',
    'create_addon', 'update_addon', 'move_addon',
    'add_product_addon_group', 'move_product_addon_group',
    'create_combo', 'update_combo', 'move_combo',
    'add_combo_item', 'update_combo_item', 'move_combo_item'
  ] loop
    select pg_get_functiondef(p.oid) into def
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = fn and p.prokind = 'f';

    if def is null then
      raise exception 'P1-02: funcao public.% nao encontrada', fn;
    end if;

    patched := replace(def, 'is_restaurant_member(', 'is_restaurant_owner(');

    if patched = def and position('is_restaurant_owner(' in def) = 0 then
      raise exception 'P1-02: public.% nao contem a checagem de membro esperada', fn;
    end if;
    if position('is_restaurant_member(' in patched) > 0 or position('is_restaurant_owner(' in patched) = 0 then
      raise exception 'P1-02: public.% ficou com checagem inesperada', fn;
    end if;

    if patched <> def then
      execute patched;
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------------ 5. convites (token) só do OWNER
drop policy if exists restaurant_invites_select_members on public.restaurant_invites;
drop policy if exists restaurant_invites_select_owner on public.restaurant_invites;
create policy restaurant_invites_select_owner on public.restaurant_invites
  for select to authenticated
  using (public.is_restaurant_owner(restaurant_id));

-- ------------------------------------------------------------------ 6. storage: escrita só do OWNER
drop policy if exists restaurant_assets_insert_members on storage.objects;
drop policy if exists restaurant_assets_update_members on storage.objects;
drop policy if exists restaurant_assets_delete_members on storage.objects;
drop policy if exists restaurant_assets_insert_owner on storage.objects;
drop policy if exists restaurant_assets_update_owner on storage.objects;
drop policy if exists restaurant_assets_delete_owner on storage.objects;

create policy restaurant_assets_insert_owner on storage.objects
  for insert to authenticated
  with check (bucket_id = 'restaurant-assets' and public.is_restaurant_owner(public.storage_path_restaurant_id(name)));
create policy restaurant_assets_update_owner on storage.objects
  for update to authenticated
  using (bucket_id = 'restaurant-assets' and public.is_restaurant_owner(public.storage_path_restaurant_id(name)))
  with check (bucket_id = 'restaurant-assets' and public.is_restaurant_owner(public.storage_path_restaurant_id(name)));
create policy restaurant_assets_delete_owner on storage.objects
  for delete to authenticated
  using (bucket_id = 'restaurant-assets' and public.is_restaurant_owner(public.storage_path_restaurant_id(name)));

-- ------------------------------------------------------------------ verificação final
do $$
declare
  n int;
begin
  select count(*) into n from pg_policies
  where schemaname = 'public' and policyname like '%\_members' escape '\'
    and cmd in ('INSERT', 'UPDATE', 'DELETE')
    and tablename not in ('products', 'addons');
  if n <> 0 then
    raise exception 'P1-02: restaram % politicas de escrita por membro', n;
  end if;

  select count(*) into n from pg_trigger t
  where t.tgname = 'guard_owner_only_writes' and not t.tgisinternal;
  if n <> 8 then
    raise exception 'P1-02: esperados 8 triggers de guarda, encontrados %', n;
  end if;

  if exists (select 1 from pg_policies where tablename = 'products' and policyname = 'products_update_members') is false then
    raise exception 'P1-02: products_update_members deveria existir (STAFF liga/desliga disponibilidade)';
  end if;
end $$;

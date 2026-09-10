-- MenuNext — Fase 2.4: Combos reais (composição por produtos existentes).
--
-- Inspeção prévia (schema real, projeto zsqxaxqiyqbdljsiuoho): não existiam
-- combos/combo_items nem equivalente. products já tem UNIQUE (id,
-- restaurant_id) (migration add_restaurant_assets_storage) — reaproveitado
-- aqui para a FK composta de combo_items, exatamente como product_images e
-- product_addon_groups já fazem. Combo NÃO duplica cadastro de produto: só
-- referencia products existentes (id/quantidade), nunca copia nome/preço/
-- categoria/adicionais.
--
-- Imagem do combo: 1 única imagem (não uma galeria como product_images) —
-- por isso um único `image_path` nullable direto na tabela combos, no mesmo
-- padrão de restaurants.logo_path/cover_path (não um product_images-like
-- separado, que existe só porque produto permite várias fotos).

-- ============================================================
-- 1. combos
-- ============================================================
create table public.combos (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null check (length(trim(name)) > 0 and length(name) <= 80),
  description text check (description is null or length(description) <= 300),
  price numeric(10, 2) not null check (price > 0),
  image_path text,
  is_available boolean not null default true,
  display_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id),
  unique (restaurant_id, display_order) deferrable initially deferred
);

create index combos_restaurant_id_idx on public.combos (restaurant_id);

create trigger set_updated_at before update on public.combos
  for each row execute function public.set_updated_at();

alter table public.combos enable row level security;

create policy "combos_select_members" on public.combos
  for select to authenticated using (public.is_restaurant_member(restaurant_id));
create policy "combos_insert_members" on public.combos
  for insert to authenticated with check (public.is_restaurant_member(restaurant_id));
create policy "combos_update_members" on public.combos
  for update to authenticated using (public.is_restaurant_member(restaurant_id));
create policy "combos_delete_members" on public.combos
  for delete to authenticated using (public.is_restaurant_member(restaurant_id));

-- ============================================================
-- 2. combo_items (composição do combo — referencia products existentes)
-- ============================================================
-- Duas FKs compostas compartilhando a MESMA coluna restaurant_id desta
-- tabela: o mesmo mecanismo já usado em product_addon_groups — impede
-- estruturalmente "combo do Restaurante A + produto do Restaurante B".
--
-- combo_id -> ON DELETE CASCADE (o item é subordinado ao combo: excluir o
-- combo remove sua composição, nunca o produto).
-- product_id -> SEM cascade: excluir um produto usado em algum combo deve
-- falhar no banco (bloqueado antes, com mensagem amigável, em
-- deleteProductAction).
create table public.combo_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  combo_id uuid not null,
  product_id uuid not null,
  quantity integer not null default 1 check (quantity >= 1 and quantity <= 99),
  display_order integer not null,
  created_at timestamptz not null default now(),
  foreign key (combo_id, restaurant_id) references public.combos (id, restaurant_id) on delete cascade,
  foreign key (product_id, restaurant_id) references public.products (id, restaurant_id),
  unique (combo_id, product_id),
  unique (combo_id, display_order) deferrable initially deferred
);

create index combo_items_restaurant_id_idx on public.combo_items (restaurant_id);
create index combo_items_combo_id_idx on public.combo_items (combo_id);
create index combo_items_product_id_idx on public.combo_items (product_id);

alter table public.combo_items enable row level security;

create policy "combo_items_select_members" on public.combo_items
  for select to authenticated using (public.is_restaurant_member(restaurant_id));
create policy "combo_items_insert_members" on public.combo_items
  for insert to authenticated with check (public.is_restaurant_member(restaurant_id));
create policy "combo_items_update_members" on public.combo_items
  for update to authenticated using (public.is_restaurant_member(restaurant_id));
create policy "combo_items_delete_members" on public.combo_items
  for delete to authenticated using (public.is_restaurant_member(restaurant_id));

-- ============================================================
-- 3. RPC: criação de combo (determina restaurant_id/display_order no
--    servidor; valida nome/descrição/preço no banco, não só no cliente)
-- ============================================================
create or replace function public.create_combo(
  p_restaurant_id uuid,
  p_name text,
  p_description text default null,
  p_price numeric default null,
  p_is_available boolean default true
)
returns public.combos
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_name text := trim(p_name);
  v_description text := nullif(trim(coalesce(p_description, '')), '');
  v_next_order int;
  v_combo public.combos;
begin
  if not public.is_restaurant_member(p_restaurant_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if v_name = '' then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if length(v_name) > 80 then
    raise exception 'name_too_long' using errcode = '22023';
  end if;
  if v_description is not null and length(v_description) > 300 then
    raise exception 'description_too_long' using errcode = '22023';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;

  select coalesce(max(display_order), 0) + 1 into v_next_order
  from public.combos where restaurant_id = p_restaurant_id;

  insert into public.combos (restaurant_id, name, description, price, is_available, display_order)
  values (p_restaurant_id, v_name, v_description, p_price, coalesce(p_is_available, true), v_next_order)
  returning * into v_combo;

  return v_combo;
end;
$$;

revoke all on function public.create_combo(uuid, text, text, numeric, boolean) from public, anon;
grant execute on function public.create_combo(uuid, text, text, numeric, boolean) to authenticated;

-- ============================================================
-- 4. RPC: edição de combo
-- ============================================================
create or replace function public.update_combo(
  p_combo_id uuid,
  p_name text,
  p_description text default null,
  p_price numeric default null,
  p_is_available boolean default true
)
returns public.combos
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_restaurant_id uuid;
  v_name text := trim(p_name);
  v_description text := nullif(trim(coalesce(p_description, '')), '');
  v_combo public.combos;
begin
  select restaurant_id into v_restaurant_id from public.combos where id = p_combo_id;

  if v_restaurant_id is null or not public.is_restaurant_member(v_restaurant_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if v_name = '' then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if length(v_name) > 80 then
    raise exception 'name_too_long' using errcode = '22023';
  end if;
  if v_description is not null and length(v_description) > 300 then
    raise exception 'description_too_long' using errcode = '22023';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;

  update public.combos set
    name = v_name,
    description = v_description,
    price = p_price,
    is_available = coalesce(p_is_available, true)
  where id = p_combo_id
  returning * into v_combo;

  return v_combo;
end;
$$;

revoke all on function public.update_combo(uuid, text, text, numeric, boolean) from public, anon;
grant execute on function public.update_combo(uuid, text, text, numeric, boolean) to authenticated;

-- ============================================================
-- 5. RPC: reordenar combo (dentro do restaurante)
-- ============================================================
create or replace function public.move_combo(p_combo_id uuid, p_direction text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_restaurant_id uuid;
  v_current_order int;
  v_neighbor_id uuid;
  v_neighbor_order int;
begin
  select restaurant_id, display_order into v_restaurant_id, v_current_order
  from public.combos where id = p_combo_id;

  if v_restaurant_id is null or not public.is_restaurant_member(v_restaurant_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_direction = 'up' then
    select id, display_order into v_neighbor_id, v_neighbor_order
    from public.combos
    where restaurant_id = v_restaurant_id and display_order < v_current_order
    order by display_order desc limit 1;
  elsif p_direction = 'down' then
    select id, display_order into v_neighbor_id, v_neighbor_order
    from public.combos
    where restaurant_id = v_restaurant_id and display_order > v_current_order
    order by display_order asc limit 1;
  else
    raise exception 'invalid_direction' using errcode = '22023';
  end if;

  if v_neighbor_id is null then
    return;
  end if;

  update public.combos set display_order = v_neighbor_order where id = p_combo_id;
  update public.combos set display_order = v_current_order where id = v_neighbor_id;
end;
$$;

revoke all on function public.move_combo(uuid, text) from public, anon;
grant execute on function public.move_combo(uuid, text) to authenticated;

-- ============================================================
-- 6. RPC: adicionar produto ao combo (valida produto do mesmo tenant, sem
--    duplicidade, quantidade 1..99)
-- ============================================================
create or replace function public.add_combo_item(p_combo_id uuid, p_product_id uuid, p_quantity integer default 1)
returns public.combo_items
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_restaurant_id uuid;
  v_next_order int;
  v_item public.combo_items;
begin
  select restaurant_id into v_restaurant_id from public.combos where id = p_combo_id;

  if v_restaurant_id is null or not public.is_restaurant_member(v_restaurant_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > 99 then
    raise exception 'invalid_quantity' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.products
    where id = p_product_id and restaurant_id = v_restaurant_id
  ) then
    raise exception 'invalid_product' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.combo_items
    where combo_id = p_combo_id and product_id = p_product_id
  ) then
    raise exception 'item_duplicate' using errcode = '23505';
  end if;

  select coalesce(max(display_order), 0) + 1 into v_next_order
  from public.combo_items where combo_id = p_combo_id;

  insert into public.combo_items (restaurant_id, combo_id, product_id, quantity, display_order)
  values (v_restaurant_id, p_combo_id, p_product_id, p_quantity, v_next_order)
  returning * into v_item;

  return v_item;
end;
$$;

revoke all on function public.add_combo_item(uuid, uuid, integer) from public, anon;
grant execute on function public.add_combo_item(uuid, uuid, integer) to authenticated;

-- ============================================================
-- 7. RPC: editar quantidade de um item do combo (não move o item de combo
--    nem troca o produto — fora do escopo desta fase, mesmo critério já
--    usado em update_addon)
-- ============================================================
create or replace function public.update_combo_item(p_item_id uuid, p_quantity integer)
returns public.combo_items
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_restaurant_id uuid;
  v_item public.combo_items;
begin
  select restaurant_id into v_restaurant_id from public.combo_items where id = p_item_id;

  if v_restaurant_id is null or not public.is_restaurant_member(v_restaurant_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > 99 then
    raise exception 'invalid_quantity' using errcode = '22023';
  end if;

  update public.combo_items set quantity = p_quantity
  where id = p_item_id
  returning * into v_item;

  return v_item;
end;
$$;

revoke all on function public.update_combo_item(uuid, integer) from public, anon;
grant execute on function public.update_combo_item(uuid, integer) to authenticated;

-- ============================================================
-- 8. RPC: reordenar item dentro do próprio combo
-- ============================================================
create or replace function public.move_combo_item(p_item_id uuid, p_direction text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_restaurant_id uuid;
  v_combo_id uuid;
  v_current_order int;
  v_neighbor_id uuid;
  v_neighbor_order int;
begin
  select restaurant_id, combo_id, display_order into v_restaurant_id, v_combo_id, v_current_order
  from public.combo_items where id = p_item_id;

  if v_restaurant_id is null or not public.is_restaurant_member(v_restaurant_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_direction = 'up' then
    select id, display_order into v_neighbor_id, v_neighbor_order
    from public.combo_items
    where combo_id = v_combo_id and display_order < v_current_order
    order by display_order desc limit 1;
  elsif p_direction = 'down' then
    select id, display_order into v_neighbor_id, v_neighbor_order
    from public.combo_items
    where combo_id = v_combo_id and display_order > v_current_order
    order by display_order asc limit 1;
  else
    raise exception 'invalid_direction' using errcode = '22023';
  end if;

  if v_neighbor_id is null then
    return;
  end if;

  update public.combo_items set display_order = v_neighbor_order where id = p_item_id;
  update public.combo_items set display_order = v_current_order where id = v_neighbor_id;
end;
$$;

revoke all on function public.move_combo_item(uuid, text) from public, anon;
grant execute on function public.move_combo_item(uuid, text) to authenticated;

-- MenuNext — Fase 2.3: Adicionais reais (grupos + itens + associação a produtos).
--
-- Inspeção prévia (schema real, projeto zsqxaxqiyqbdljsiuoho): não existiam
-- addon_groups/addons/product_addon_groups nem equivalente. Reaproveita
-- exatamente o padrão de categories/products: is_restaurant_member() nas
-- policies, UNIQUE (id, restaurant_id) para FK composta, UNIQUE
-- (.., display_order) deferrable para reordenação por swap, RPC
-- SECURITY DEFINER para operações que determinam valores no servidor
-- (restaurant_id, display_order) e validam regras de negócio.

-- ============================================================
-- 1. addon_groups
-- ============================================================
create table public.addon_groups (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null check (length(trim(name)) > 0 and length(name) <= 80),
  description text check (description is null or length(description) <= 200),
  min_selections integer not null default 0 check (min_selections >= 0),
  max_selections integer not null default 1 check (max_selections >= 1 and max_selections <= 20),
  is_required boolean not null default false,
  is_active boolean not null default true,
  display_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- min <= max sempre; grupo obrigatório nunca pode ter mínimo 0 (regra
  -- coerente entre is_required e min_selections, garantida no banco).
  check (min_selections <= max_selections),
  check (not is_required or min_selections >= 1),
  unique (id, restaurant_id),
  unique (restaurant_id, display_order) deferrable initially deferred
);

create index addon_groups_restaurant_id_idx on public.addon_groups (restaurant_id);

create trigger set_updated_at before update on public.addon_groups
  for each row execute function public.set_updated_at();

alter table public.addon_groups enable row level security;

create policy "addon_groups_select_members" on public.addon_groups
  for select to authenticated using (public.is_restaurant_member(restaurant_id));
create policy "addon_groups_insert_members" on public.addon_groups
  for insert to authenticated with check (public.is_restaurant_member(restaurant_id));
create policy "addon_groups_update_members" on public.addon_groups
  for update to authenticated using (public.is_restaurant_member(restaurant_id));
create policy "addon_groups_delete_members" on public.addon_groups
  for delete to authenticated using (public.is_restaurant_member(restaurant_id));

-- ============================================================
-- 2. addons (itens de um grupo)
-- ============================================================
-- Sem SKU/estoque/custo/peso/dimensões/fornecedor — só o preço adicional.
-- FK composta garante addon.restaurant_id = addon_group.restaurant_id (o
-- mesmo mecanismo já usado em products -> categories). Sem "on delete
-- cascade": excluir um grupo com itens deve falhar no banco (bloqueado
-- pelo server action com uma mensagem amigável antes disso).
create table public.addons (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  addon_group_id uuid not null,
  name text not null check (length(trim(name)) > 0 and length(name) <= 80),
  description text check (description is null or length(description) <= 200),
  price numeric(10, 2) not null default 0 check (price >= 0),
  is_available boolean not null default true,
  display_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (addon_group_id, restaurant_id) references public.addon_groups (id, restaurant_id),
  unique (addon_group_id, display_order) deferrable initially deferred
);

create index addons_restaurant_id_idx on public.addons (restaurant_id);
create index addons_addon_group_id_idx on public.addons (addon_group_id);

create trigger set_updated_at before update on public.addons
  for each row execute function public.set_updated_at();

alter table public.addons enable row level security;

create policy "addons_select_members" on public.addons
  for select to authenticated using (public.is_restaurant_member(restaurant_id));
create policy "addons_insert_members" on public.addons
  for insert to authenticated with check (public.is_restaurant_member(restaurant_id));
create policy "addons_update_members" on public.addons
  for update to authenticated using (public.is_restaurant_member(restaurant_id));
create policy "addons_delete_members" on public.addons
  for delete to authenticated using (public.is_restaurant_member(restaurant_id));

-- ============================================================
-- 3. product_addon_groups (associação produto <-> grupo)
-- ============================================================
-- Tabela de associação pura (não guarda o cadastro principal do grupo nem
-- do produto) — por isso, diferente de addons/addon_groups, aqui É seguro
-- usar ON DELETE CASCADE nas duas pontas: se o produto for excluído, ou se
-- o grupo for excluído (já garantido sem itens, ver acima), a associação
-- correspondente deixa de fazer sentido e pode sumir junto, sem apagar
-- nenhum cadastro principal.
--
-- As duas FKs compostas compartilham a MESMA coluna restaurant_id desta
-- tabela — isso é o que impede produto do Restaurante A + grupo do
-- Restaurante B: a linha só pode existir se restaurant_id bater com o
-- restaurante REAL do produto E com o do grupo ao mesmo tempo.
create table public.product_addon_groups (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  product_id uuid not null,
  addon_group_id uuid not null,
  display_order integer not null,
  created_at timestamptz not null default now(),
  foreign key (product_id, restaurant_id) references public.products (id, restaurant_id) on delete cascade,
  foreign key (addon_group_id, restaurant_id) references public.addon_groups (id, restaurant_id) on delete cascade,
  unique (product_id, addon_group_id),
  unique (product_id, display_order) deferrable initially deferred
);

create index product_addon_groups_restaurant_id_idx on public.product_addon_groups (restaurant_id);
create index product_addon_groups_product_id_idx on public.product_addon_groups (product_id);
create index product_addon_groups_addon_group_id_idx on public.product_addon_groups (addon_group_id);

alter table public.product_addon_groups enable row level security;

create policy "product_addon_groups_select_members" on public.product_addon_groups
  for select to authenticated using (public.is_restaurant_member(restaurant_id));
create policy "product_addon_groups_insert_members" on public.product_addon_groups
  for insert to authenticated with check (public.is_restaurant_member(restaurant_id));
create policy "product_addon_groups_update_members" on public.product_addon_groups
  for update to authenticated using (public.is_restaurant_member(restaurant_id));
create policy "product_addon_groups_delete_members" on public.product_addon_groups
  for delete to authenticated using (public.is_restaurant_member(restaurant_id));

-- ============================================================
-- 4. RPC: criação de grupo (determina restaurant_id/display_order no
--    servidor; valida min/max/obrigatório no banco, não só no cliente)
-- ============================================================
create or replace function public.create_addon_group(
  p_restaurant_id uuid,
  p_name text,
  p_description text default null,
  p_min_selections integer default 0,
  p_max_selections integer default 1,
  p_is_required boolean default false
)
returns public.addon_groups
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_name text := trim(p_name);
  v_description text := nullif(trim(coalesce(p_description, '')), '');
  v_next_order int;
  v_group public.addon_groups;
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
  if v_description is not null and length(v_description) > 200 then
    raise exception 'description_too_long' using errcode = '22023';
  end if;
  if p_min_selections is null or p_min_selections < 0 then
    raise exception 'invalid_min' using errcode = '22023';
  end if;
  if p_max_selections is null or p_max_selections < 1 or p_max_selections > 20 then
    raise exception 'invalid_max' using errcode = '22023';
  end if;
  if p_min_selections > p_max_selections then
    raise exception 'min_greater_than_max' using errcode = '22023';
  end if;
  if p_is_required and p_min_selections < 1 then
    raise exception 'required_needs_min' using errcode = '22023';
  end if;

  select coalesce(max(display_order), 0) + 1 into v_next_order
  from public.addon_groups where restaurant_id = p_restaurant_id;

  insert into public.addon_groups (
    restaurant_id, name, description, min_selections, max_selections, is_required, display_order
  )
  values (
    p_restaurant_id, v_name, v_description, p_min_selections, p_max_selections, coalesce(p_is_required, false), v_next_order
  )
  returning * into v_group;

  return v_group;
end;
$$;

revoke all on function public.create_addon_group(uuid, text, text, integer, integer, boolean) from public, anon;
grant execute on function public.create_addon_group(uuid, text, text, integer, integer, boolean) to authenticated;

-- ============================================================
-- 5. RPC: edição de grupo
-- ============================================================
create or replace function public.update_addon_group(
  p_group_id uuid,
  p_name text,
  p_description text default null,
  p_min_selections integer default 0,
  p_max_selections integer default 1,
  p_is_required boolean default false
)
returns public.addon_groups
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_restaurant_id uuid;
  v_name text := trim(p_name);
  v_description text := nullif(trim(coalesce(p_description, '')), '');
  v_group public.addon_groups;
begin
  select restaurant_id into v_restaurant_id from public.addon_groups where id = p_group_id;

  if v_restaurant_id is null or not public.is_restaurant_member(v_restaurant_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if v_name = '' then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if length(v_name) > 80 then
    raise exception 'name_too_long' using errcode = '22023';
  end if;
  if v_description is not null and length(v_description) > 200 then
    raise exception 'description_too_long' using errcode = '22023';
  end if;
  if p_min_selections is null or p_min_selections < 0 then
    raise exception 'invalid_min' using errcode = '22023';
  end if;
  if p_max_selections is null or p_max_selections < 1 or p_max_selections > 20 then
    raise exception 'invalid_max' using errcode = '22023';
  end if;
  if p_min_selections > p_max_selections then
    raise exception 'min_greater_than_max' using errcode = '22023';
  end if;
  if p_is_required and p_min_selections < 1 then
    raise exception 'required_needs_min' using errcode = '22023';
  end if;

  update public.addon_groups set
    name = v_name,
    description = v_description,
    min_selections = p_min_selections,
    max_selections = p_max_selections,
    is_required = coalesce(p_is_required, false)
  where id = p_group_id
  returning * into v_group;

  return v_group;
end;
$$;

revoke all on function public.update_addon_group(uuid, text, text, integer, integer, boolean) from public, anon;
grant execute on function public.update_addon_group(uuid, text, text, integer, integer, boolean) to authenticated;

-- ============================================================
-- 6. RPC: reordenar grupo (dentro do restaurante)
-- ============================================================
create or replace function public.move_addon_group(p_group_id uuid, p_direction text)
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
  from public.addon_groups where id = p_group_id;

  if v_restaurant_id is null or not public.is_restaurant_member(v_restaurant_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_direction = 'up' then
    select id, display_order into v_neighbor_id, v_neighbor_order
    from public.addon_groups
    where restaurant_id = v_restaurant_id and display_order < v_current_order
    order by display_order desc limit 1;
  elsif p_direction = 'down' then
    select id, display_order into v_neighbor_id, v_neighbor_order
    from public.addon_groups
    where restaurant_id = v_restaurant_id and display_order > v_current_order
    order by display_order asc limit 1;
  else
    raise exception 'invalid_direction' using errcode = '22023';
  end if;

  if v_neighbor_id is null then
    return;
  end if;

  update public.addon_groups set display_order = v_neighbor_order where id = p_group_id;
  update public.addon_groups set display_order = v_current_order where id = v_neighbor_id;
end;
$$;

revoke all on function public.move_addon_group(uuid, text) from public, anon;
grant execute on function public.move_addon_group(uuid, text) to authenticated;

-- ============================================================
-- 7. RPC: criação de item (valida grupo do mesmo tenant, preço >= 0)
-- ============================================================
create or replace function public.create_addon(
  p_restaurant_id uuid,
  p_addon_group_id uuid,
  p_name text,
  p_description text default null,
  p_price numeric default 0,
  p_is_available boolean default true
)
returns public.addons
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_name text := trim(p_name);
  v_description text := nullif(trim(coalesce(p_description, '')), '');
  v_next_order int;
  v_addon public.addons;
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
  if v_description is not null and length(v_description) > 200 then
    raise exception 'description_too_long' using errcode = '22023';
  end if;
  if p_price is null or p_price < 0 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.addon_groups
    where id = p_addon_group_id and restaurant_id = p_restaurant_id
  ) then
    raise exception 'invalid_group' using errcode = '22023';
  end if;

  select coalesce(max(display_order), 0) + 1 into v_next_order
  from public.addons where addon_group_id = p_addon_group_id;

  insert into public.addons (restaurant_id, addon_group_id, name, description, price, is_available, display_order)
  values (p_restaurant_id, p_addon_group_id, v_name, v_description, p_price, coalesce(p_is_available, true), v_next_order)
  returning * into v_addon;

  return v_addon;
end;
$$;

revoke all on function public.create_addon(uuid, uuid, text, text, numeric, boolean) from public, anon;
grant execute on function public.create_addon(uuid, uuid, text, text, numeric, boolean) to authenticated;

-- ============================================================
-- 8. RPC: edição de item (nome/descrição/preço/disponibilidade — não move
--    o item de grupo, isso não faz parte do escopo desta fase)
-- ============================================================
create or replace function public.update_addon(
  p_addon_id uuid,
  p_name text,
  p_description text default null,
  p_price numeric default 0,
  p_is_available boolean default true
)
returns public.addons
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_restaurant_id uuid;
  v_name text := trim(p_name);
  v_description text := nullif(trim(coalesce(p_description, '')), '');
  v_addon public.addons;
begin
  select restaurant_id into v_restaurant_id from public.addons where id = p_addon_id;

  if v_restaurant_id is null or not public.is_restaurant_member(v_restaurant_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if v_name = '' then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if length(v_name) > 80 then
    raise exception 'name_too_long' using errcode = '22023';
  end if;
  if v_description is not null and length(v_description) > 200 then
    raise exception 'description_too_long' using errcode = '22023';
  end if;
  if p_price is null or p_price < 0 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;

  update public.addons set
    name = v_name,
    description = v_description,
    price = p_price,
    is_available = coalesce(p_is_available, true)
  where id = p_addon_id
  returning * into v_addon;

  return v_addon;
end;
$$;

revoke all on function public.update_addon(uuid, text, text, numeric, boolean) from public, anon;
grant execute on function public.update_addon(uuid, text, text, numeric, boolean) to authenticated;

-- ============================================================
-- 9. RPC: reordenar item (dentro do próprio grupo)
-- ============================================================
create or replace function public.move_addon(p_addon_id uuid, p_direction text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_restaurant_id uuid;
  v_group_id uuid;
  v_current_order int;
  v_neighbor_id uuid;
  v_neighbor_order int;
begin
  select restaurant_id, addon_group_id, display_order into v_restaurant_id, v_group_id, v_current_order
  from public.addons where id = p_addon_id;

  if v_restaurant_id is null or not public.is_restaurant_member(v_restaurant_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_direction = 'up' then
    select id, display_order into v_neighbor_id, v_neighbor_order
    from public.addons
    where addon_group_id = v_group_id and display_order < v_current_order
    order by display_order desc limit 1;
  elsif p_direction = 'down' then
    select id, display_order into v_neighbor_id, v_neighbor_order
    from public.addons
    where addon_group_id = v_group_id and display_order > v_current_order
    order by display_order asc limit 1;
  else
    raise exception 'invalid_direction' using errcode = '22023';
  end if;

  if v_neighbor_id is null then
    return;
  end if;

  update public.addons set display_order = v_neighbor_order where id = p_addon_id;
  update public.addons set display_order = v_current_order where id = v_neighbor_id;
end;
$$;

revoke all on function public.move_addon(uuid, text) from public, anon;
grant execute on function public.move_addon(uuid, text) to authenticated;

-- ============================================================
-- 10. RPC: associar grupo a produto (determina restaurant_id a partir do
--     produto; valida que o grupo é do mesmo tenant; nunca confia em
--     restaurant_id vindo do cliente)
-- ============================================================
create or replace function public.add_product_addon_group(p_product_id uuid, p_addon_group_id uuid)
returns public.product_addon_groups
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_restaurant_id uuid;
  v_next_order int;
  v_association public.product_addon_groups;
begin
  select restaurant_id into v_restaurant_id from public.products where id = p_product_id;

  if v_restaurant_id is null or not public.is_restaurant_member(v_restaurant_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.addon_groups
    where id = p_addon_group_id and restaurant_id = v_restaurant_id
  ) then
    raise exception 'invalid_group' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.product_addon_groups
    where product_id = p_product_id and addon_group_id = p_addon_group_id
  ) then
    raise exception 'association_duplicate' using errcode = '23505';
  end if;

  select coalesce(max(display_order), 0) + 1 into v_next_order
  from public.product_addon_groups where product_id = p_product_id;

  insert into public.product_addon_groups (restaurant_id, product_id, addon_group_id, display_order)
  values (v_restaurant_id, p_product_id, p_addon_group_id, v_next_order)
  returning * into v_association;

  return v_association;
end;
$$;

revoke all on function public.add_product_addon_group(uuid, uuid) from public, anon;
grant execute on function public.add_product_addon_group(uuid, uuid) to authenticated;

-- ============================================================
-- 11. RPC: reordenar grupo associado a um produto
-- ============================================================
create or replace function public.move_product_addon_group(p_association_id uuid, p_direction text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_restaurant_id uuid;
  v_product_id uuid;
  v_current_order int;
  v_neighbor_id uuid;
  v_neighbor_order int;
begin
  select restaurant_id, product_id, display_order into v_restaurant_id, v_product_id, v_current_order
  from public.product_addon_groups where id = p_association_id;

  if v_restaurant_id is null or not public.is_restaurant_member(v_restaurant_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_direction = 'up' then
    select id, display_order into v_neighbor_id, v_neighbor_order
    from public.product_addon_groups
    where product_id = v_product_id and display_order < v_current_order
    order by display_order desc limit 1;
  elsif p_direction = 'down' then
    select id, display_order into v_neighbor_id, v_neighbor_order
    from public.product_addon_groups
    where product_id = v_product_id and display_order > v_current_order
    order by display_order asc limit 1;
  else
    raise exception 'invalid_direction' using errcode = '22023';
  end if;

  if v_neighbor_id is null then
    return;
  end if;

  update public.product_addon_groups set display_order = v_neighbor_order where id = p_association_id;
  update public.product_addon_groups set display_order = v_current_order where id = v_neighbor_id;
end;
$$;

revoke all on function public.move_product_addon_group(uuid, text) from public, anon;
grant execute on function public.move_product_addon_group(uuid, text) to authenticated;

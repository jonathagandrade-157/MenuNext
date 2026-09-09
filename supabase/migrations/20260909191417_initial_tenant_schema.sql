-- MenuNext — Sprint 1: fundação multi-tenant (profiles, restaurants,
-- restaurant_members, onboarding_progress, business_hours, products) + RLS.
--
-- Modelo: Auth User -> Profile (1:1, via trigger) -> Restaurant (criado no
-- onboarding, via RPC) -> Restaurant Member OWNER (criado junto, na mesma RPC).
-- Nenhuma tabela de negócio confia em restaurant_id vindo do cliente sem
-- checagem em `restaurant_members`: toda policy usa `is_restaurant_member()`.

-- ============================================================
-- 1. TABELAS
-- ============================================================

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  name text not null default '',
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) >= 3),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'closed')),
  onboarding_completed boolean not null default false,
  onboarding_step smallint not null default 1 check (onboarding_step between 1 and 7),

  -- Passo 2: endereço
  address_zip text,
  address_street text,
  address_number text,
  address_complement text,
  address_neighborhood text,
  address_city text,
  address_state text,

  -- Passo 3: modo de atendimento
  service_delivery boolean not null default false,
  service_pickup boolean not null default false,

  -- Passo 4: delivery
  delivery_fee numeric(10, 2),
  delivery_radius_km numeric(5, 2),

  -- Passo 6: pagamentos aceitos pelo restaurante (não é a assinatura do SaaS)
  payment_pix boolean not null default false,
  payment_pix_key text,
  payment_cash boolean not null default false,
  payment_card boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.restaurant_members (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'OWNER' check (role in ('OWNER', 'STAFF')),
  created_at timestamptz not null default now(),
  unique (restaurant_id, user_id)
);

create index restaurant_members_user_id_idx on public.restaurant_members (user_id);
create index restaurant_members_restaurant_id_idx on public.restaurant_members (restaurant_id);

create table public.onboarding_progress (
  restaurant_id uuid primary key references public.restaurants (id) on delete cascade,
  current_step smallint not null default 1 check (current_step between 1 and 7),
  completed_steps smallint[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table public.business_hours (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6), -- 0 = domingo .. 6 = sábado
  is_open boolean not null default false,
  opens_at time,
  closes_at time,
  unique (restaurant_id, day_of_week)
);

create index business_hours_restaurant_id_idx on public.business_hours (restaurant_id);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text,
  price numeric(10, 2) not null check (price >= 0),
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_restaurant_id_idx on public.products (restaurant_id);

-- ============================================================
-- 2. updated_at automático
-- ============================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.restaurants
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.onboarding_progress
  for each row execute function public.set_updated_at();

-- ============================================================
-- 3. Trigger: Auth User -> Profile
-- ============================================================
-- Executa como SECURITY DEFINER (dono: postgres) para poder inserir em
-- public.profiles a partir de um trigger em auth.users. Restaurant e
-- Restaurant Member NÃO são criados aqui: nome/slug só existem quando o
-- lojista preenche o Passo 1 do onboarding (ver create_restaurant() abaixo).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    new.raw_user_meta_data ->> 'phone'
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 4. Helpers de autorização (SECURITY DEFINER, search_path fixo)
-- ============================================================

create or replace function public.is_restaurant_member(target_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.restaurant_members m
    where m.restaurant_id = target_restaurant_id
      and m.user_id = auth.uid()
  );
$$;

revoke all on function public.is_restaurant_member(uuid) from public;
grant execute on function public.is_restaurant_member(uuid) to authenticated;

-- Checagem de slug disponível sem expor dados do restaurante a quem não é membro.
create or replace function public.is_slug_available(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.restaurants where slug = lower(trim(p_slug))
  );
$$;

grant execute on function public.is_slug_available(text) to authenticated;

-- ============================================================
-- 5. RPC: criação atômica do restaurante (Passo 1 do onboarding)
-- ============================================================
-- Auth User -> Restaurant -> Restaurant Member OWNER -> Onboarding Progress
-- em uma única transação. Idempotente: se o usuário já possui um
-- restaurante, retorna o existente em vez de criar um duplicado.

create or replace function public.create_restaurant(p_name text, p_slug text)
returns public.restaurants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_restaurant public.restaurants;
  v_existing_restaurant_id uuid;
  v_slug text := lower(trim(p_slug));
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;

  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_slug) < 3 then
    raise exception 'invalid_slug' using errcode = '22023';
  end if;

  select rm.restaurant_id into v_existing_restaurant_id
  from public.restaurant_members rm
  where rm.user_id = v_user_id
  limit 1;

  if v_existing_restaurant_id is not null then
    select * into v_restaurant from public.restaurants where id = v_existing_restaurant_id;
    return v_restaurant;
  end if;

  insert into public.restaurants (name, slug)
  values (trim(p_name), v_slug)
  returning * into v_restaurant;

  insert into public.restaurant_members (restaurant_id, user_id, role)
  values (v_restaurant.id, v_user_id, 'OWNER');

  insert into public.onboarding_progress (restaurant_id, current_step, completed_steps)
  values (v_restaurant.id, 1, '{}');

  return v_restaurant;
exception
  when unique_violation then
    raise exception 'slug_taken' using errcode = '23505';
end;
$$;

revoke all on function public.create_restaurant(text, text) from public;
grant execute on function public.create_restaurant(text, text) to authenticated;

-- ============================================================
-- 6. RLS
-- ============================================================

alter table public.profiles enable row level security;
alter table public.restaurants enable row level security;
alter table public.restaurant_members enable row level security;
alter table public.onboarding_progress enable row level security;
alter table public.business_hours enable row level security;
alter table public.products enable row level security;

-- profiles: cada usuário só vê/edita o próprio perfil.
create policy "profiles_select_own" on public.profiles
  for select using (user_id = auth.uid());
create policy "profiles_update_own" on public.profiles
  for update using (user_id = auth.uid());
create policy "profiles_insert_own" on public.profiles
  for insert with check (user_id = auth.uid());

-- restaurants: só membros enxergam/editam o próprio restaurante.
-- Sem policy de INSERT: criação só pela RPC create_restaurant() (SECURITY DEFINER).
create policy "restaurants_select_members" on public.restaurants
  for select using (public.is_restaurant_member(id));
create policy "restaurants_update_members" on public.restaurants
  for update using (public.is_restaurant_member(id));

-- restaurant_members: usuário vê suas próprias associações e as dos colegas
-- do(s) mesmo(s) restaurante(s). Sem policy de INSERT/UPDATE/DELETE: só a
-- RPC create_restaurant() (SECURITY DEFINER) escreve nesta tabela nesta Sprint.
create policy "restaurant_members_select_related" on public.restaurant_members
  for select using (
    user_id = auth.uid() or public.is_restaurant_member(restaurant_id)
  );

-- onboarding_progress: só membros do restaurante. Sem policy de INSERT:
-- a linha nasce junto com o restaurante, na RPC.
create policy "onboarding_progress_select_members" on public.onboarding_progress
  for select using (public.is_restaurant_member(restaurant_id));
create policy "onboarding_progress_update_members" on public.onboarding_progress
  for update using (public.is_restaurant_member(restaurant_id));

-- business_hours: CRUD liberado para membros do restaurante dono das linhas.
create policy "business_hours_select_members" on public.business_hours
  for select using (public.is_restaurant_member(restaurant_id));
create policy "business_hours_insert_members" on public.business_hours
  for insert with check (public.is_restaurant_member(restaurant_id));
create policy "business_hours_update_members" on public.business_hours
  for update using (public.is_restaurant_member(restaurant_id));
create policy "business_hours_delete_members" on public.business_hours
  for delete using (public.is_restaurant_member(restaurant_id));

-- products: CRUD liberado para membros do restaurante dono das linhas.
create policy "products_select_members" on public.products
  for select using (public.is_restaurant_member(restaurant_id));
create policy "products_insert_members" on public.products
  for insert with check (public.is_restaurant_member(restaurant_id));
create policy "products_update_members" on public.products
  for update using (public.is_restaurant_member(restaurant_id));
create policy "products_delete_members" on public.products
  for delete using (public.is_restaurant_member(restaurant_id));

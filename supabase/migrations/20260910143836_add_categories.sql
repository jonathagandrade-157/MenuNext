-- MenuNext — Fase 2.1: CRUD real de Categorias do cardápio.
--
-- Inspeção prévia: não existia tabela `categories` nem equivalente.
-- `products` ainda NÃO tem `category_id` (Produtos é a próxima fase, fora
-- de escopo aqui) — por isso a regra de "impedir exclusão de categoria com
-- produtos vinculados" não pode ser implementada de verdade nesta migration
-- (não existe FK products->categories ainda). Isso é intencional, não um
-- esquecimento: ver relatório da Fase 2.1. A tabela já nasce com a coluna
-- e os índices certos para que a fase de Produtos só precise adicionar
-- `products.category_id` e a checagem no server action de exclusão.

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null check (length(trim(name)) > 0 and length(name) <= 80),
  description text check (description is null or length(description) <= 200),
  display_order integer not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- deferrable: a troca de ordem entre duas categorias (mover para
  -- cima/baixo) faz UPDATE em duas linhas na mesma transação — sem
  -- deferrable, a 1ª UPDATE já violaria a unicidade antes da 2ª rodar.
  unique (restaurant_id, display_order) deferrable initially deferred
);

create index categories_restaurant_id_idx on public.categories (restaurant_id);

-- Duplicidade por nome é por restaurante, ignorando maiúsculas/minúsculas e
-- espaços nas pontas — dois restaurantes diferentes podem ter "Hambúrgueres".
create unique index categories_restaurant_id_name_unique_idx
  on public.categories (restaurant_id, lower(trim(name)));

create trigger set_updated_at before update on public.categories
  for each row execute function public.set_updated_at();

alter table public.categories enable row level security;

-- Mesmo padrão de products/business_hours: CRUD liberado para membros do
-- restaurante dono das linhas, via is_restaurant_member() já existente.
create policy "categories_select_members" on public.categories
  for select to authenticated using (public.is_restaurant_member(restaurant_id));
create policy "categories_insert_members" on public.categories
  for insert to authenticated with check (public.is_restaurant_member(restaurant_id));
create policy "categories_update_members" on public.categories
  for update to authenticated using (public.is_restaurant_member(restaurant_id));
create policy "categories_delete_members" on public.categories
  for delete to authenticated using (public.is_restaurant_member(restaurant_id));

-- ============================================================
-- RPC: criação (determina display_order e valida duplicidade no servidor,
-- nunca confiando no que o cliente mandar)
-- ============================================================
create or replace function public.create_category(p_restaurant_id uuid, p_name text, p_description text default null)
returns public.categories
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_name text := trim(p_name);
  v_description text := nullif(trim(coalesce(p_description, '')), '');
  v_next_order int;
  v_category public.categories;
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

  if exists (
    select 1 from public.categories
    where restaurant_id = p_restaurant_id and lower(trim(name)) = lower(v_name)
  ) then
    raise exception 'category_duplicate' using errcode = '23505';
  end if;

  select coalesce(max(display_order), 0) + 1 into v_next_order
  from public.categories where restaurant_id = p_restaurant_id;

  insert into public.categories (restaurant_id, name, description, display_order)
  values (p_restaurant_id, v_name, v_description, v_next_order)
  returning * into v_category;

  return v_category;
end;
$$;

revoke all on function public.create_category(uuid, text, text) from public, anon;
grant execute on function public.create_category(uuid, text, text) to authenticated;

-- ============================================================
-- RPC: reordenação (troca display_order com o vizinho, atomicamente)
-- ============================================================
create or replace function public.move_category(p_category_id uuid, p_direction text)
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
  from public.categories where id = p_category_id;

  if v_restaurant_id is null or not public.is_restaurant_member(v_restaurant_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_direction = 'up' then
    select id, display_order into v_neighbor_id, v_neighbor_order
    from public.categories
    where restaurant_id = v_restaurant_id and display_order < v_current_order
    order by display_order desc limit 1;
  elsif p_direction = 'down' then
    select id, display_order into v_neighbor_id, v_neighbor_order
    from public.categories
    where restaurant_id = v_restaurant_id and display_order > v_current_order
    order by display_order asc limit 1;
  else
    raise exception 'invalid_direction' using errcode = '22023';
  end if;

  if v_neighbor_id is null then
    return; -- já está na ponta da lista: no-op, não é erro
  end if;

  update public.categories set display_order = v_neighbor_order where id = p_category_id;
  update public.categories set display_order = v_current_order where id = v_neighbor_id;
end;
$$;

revoke all on function public.move_category(uuid, text) from public, anon;
grant execute on function public.move_category(uuid, text) to authenticated;

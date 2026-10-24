-- MenuNext — custo dos produtos em tabela própria, legível só por quem é da loja.
--
-- PROBLEMA: products.cost ficava numa tabela cuja leitura é pública (products_select_public, para
-- o cardápio da loja). Qualquer visitante — até sem login — conseguia ler o custo e, com ele, a
-- margem do restaurante. Segurança por coluna não resolve (a política pública é por linha e o
-- login de qualquer outra pessoa passaria), então o custo sai da tabela pública.
--
-- ESTA MIGRATION (1/2, aditiva):
--   * cria product_costs (1 linha por produto com custo) com RLS: só membros da loja leem;
--     ninguém escreve direto — só create_product/update_product (SECURITY DEFINER, já exigem OWNER);
--   * copia para lá os custos que já existem em products.cost;
--   * troca create_product e update_product para gravarem o custo em product_costs (a assinatura, as
--     validações e o retorno não mudam; products.cost deixa de ser escrito).
-- A coluna products.cost continua existindo até a migration 2/2 (depois que o aplicativo novo, que lê
-- de product_costs, estiver no ar) — assim nada quebra no intervalo.

create table public.product_costs (
  product_id uuid primary key references public.products (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  cost numeric(10, 2) not null check (cost >= 0),
  updated_at timestamptz not null default now()
);

create index product_costs_restaurant_idx on public.product_costs (restaurant_id);

alter table public.product_costs enable row level security;

revoke all on public.product_costs from public, anon, authenticated;
grant select on public.product_costs to authenticated;

create policy product_costs_select_members on public.product_costs
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

create trigger set_updated_at before update on public.product_costs
  for each row execute function public.set_updated_at();

-- custos que já existem
insert into public.product_costs (product_id, restaurant_id, cost)
select id, restaurant_id, cost from public.products where cost is not null
on conflict (product_id) do nothing;

create or replace function public.create_product(
  p_restaurant_id uuid,
  p_category_id uuid,
  p_name text,
  p_description text default null,
  p_price numeric default null,
  p_cost numeric default null,
  p_is_available boolean default true
)
returns products
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_name text := trim(p_name);
  v_description text := nullif(trim(coalesce(p_description, '')), '');
  v_next_order int;
  v_product public.products;
begin
  if not public.is_restaurant_owner(p_restaurant_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if v_name = '' then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if length(v_name) > 120 then
    raise exception 'name_too_long' using errcode = '22023';
  end if;
  if v_description is not null and length(v_description) > 500 then
    raise exception 'description_too_long' using errcode = '22023';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;
  if p_cost is not null and p_cost < 0 then
    raise exception 'invalid_cost' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.categories
    where id = p_category_id and restaurant_id = p_restaurant_id
  ) then
    raise exception 'invalid_category' using errcode = '22023';
  end if;

  select coalesce(max(display_order), 0) + 1 into v_next_order
  from public.products where category_id = p_category_id;

  insert into public.products (restaurant_id, category_id, name, description, price, is_available, display_order)
  values (p_restaurant_id, p_category_id, v_name, v_description, p_price, coalesce(p_is_available, true), v_next_order)
  returning * into v_product;

  if p_cost is not null then
    insert into public.product_costs (product_id, restaurant_id, cost)
    values (v_product.id, p_restaurant_id, p_cost);
  end if;

  return v_product;
end;
$function$;

create or replace function public.update_product(
  p_product_id uuid,
  p_category_id uuid,
  p_name text,
  p_description text default null,
  p_price numeric default null,
  p_cost numeric default null,
  p_is_available boolean default true
)
returns products
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_restaurant_id uuid;
  v_old_category_id uuid;
  v_name text := trim(p_name);
  v_description text := nullif(trim(coalesce(p_description, '')), '');
  v_next_order int;
  v_product public.products;
begin
  select restaurant_id, category_id into v_restaurant_id, v_old_category_id
  from public.products where id = p_product_id;

  if v_restaurant_id is null or not public.is_restaurant_owner(v_restaurant_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if v_name = '' then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if length(v_name) > 120 then
    raise exception 'name_too_long' using errcode = '22023';
  end if;
  if v_description is not null and length(v_description) > 500 then
    raise exception 'description_too_long' using errcode = '22023';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;
  if p_cost is not null and p_cost < 0 then
    raise exception 'invalid_cost' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.categories
    where id = p_category_id and restaurant_id = v_restaurant_id
  ) then
    raise exception 'invalid_category' using errcode = '22023';
  end if;

  if p_category_id <> v_old_category_id then
    select coalesce(max(display_order), 0) + 1 into v_next_order
    from public.products where category_id = p_category_id;
  else
    v_next_order := null;
  end if;

  update public.products set
    category_id = p_category_id,
    name = v_name,
    description = v_description,
    price = p_price,
    is_available = coalesce(p_is_available, true),
    display_order = coalesce(v_next_order, display_order)
  where id = p_product_id
  returning * into v_product;

  if p_cost is null then
    delete from public.product_costs where product_id = p_product_id;
  else
    insert into public.product_costs (product_id, restaurant_id, cost)
    values (p_product_id, v_restaurant_id, p_cost)
    on conflict (product_id) do update set cost = excluded.cost;
  end if;

  return v_product;
end;
$function$;

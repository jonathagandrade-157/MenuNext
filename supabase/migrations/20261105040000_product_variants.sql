-- MenuNext — variantes de produto (ex.: Pequena/Média/Grande), cada uma com preço e disponibilidade próprios.
--
-- ESCOPO DESTA MIGRATION (ADITIVA): somente o CADASTRO no painel. As variantes ainda NÃO aparecem na loja pública nem no
-- checkout, e create_order não é alterado: o cliente continua comprando pelo preço do produto. Ligar a escolha de
-- variante no pedido exige alterar create_order e fica para uma etapa própria, DEPOIS das migrations de checkout.
--
-- REGRAS
--   * Leitura: membros da loja. Escrita nunca direta: só as funções abaixo (SECURITY DEFINER).
--   * Criar/editar/apagar: OWNER da loja do produto. Ligar/desligar a disponibilidade: OWNER ou STAFF (mesma regra dos
--     produtos e adicionais).
--   * Até 20 variantes por produto; nome 1..60 sem diferença de maiúsculas/minúsculas dentro do produto; preço > 0.
--   * Apagar o produto apaga as variantes.
-- Nunca aplicada em produção por este repositório; validada em PostgreSQL sintético (supabase/tests/product_variants.sql).

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  price numeric(10, 2) not null check (price > 0 and price <= 99999.99),
  is_available boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index product_variants_name_idx on public.product_variants (product_id, lower(name));
create index product_variants_product_idx on public.product_variants (product_id, display_order);

alter table public.product_variants enable row level security;
revoke all on public.product_variants from public, anon, authenticated;
grant select on public.product_variants to authenticated;

create policy product_variants_select_members on public.product_variants
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

create trigger set_updated_at before update on public.product_variants
  for each row execute function public.set_updated_at();

create or replace function public.product_variant_create(p_product uuid, p_name text, p_price numeric, p_available boolean default true)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_restaurant uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_order integer;
  v_id uuid;
begin
  select restaurant_id into v_restaurant from public.products where id = p_product;
  if v_restaurant is null or not public.is_restaurant_owner(v_restaurant) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 60 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if p_price is null or p_price <= 0 or p_price > 99999.99 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;
  -- serializa a criação por produto (limite e ordem consistentes sob concorrência)
  perform 1 from public.products where id = p_product for update;
  if (select count(*) from public.product_variants where product_id = p_product) >= 20 then
    raise exception 'too_many_variants' using errcode = '53400';
  end if;
  select coalesce(max(display_order), 0) + 1 into v_order from public.product_variants where product_id = p_product;
  insert into public.product_variants (product_id, restaurant_id, name, price, is_available, display_order)
  values (p_product, v_restaurant, v_name, p_price, coalesce(p_available, true), v_order)
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'variant_duplicate' using errcode = '23505';
end;
$$;

create or replace function public.product_variant_update(p_variant uuid, p_name text, p_price numeric, p_available boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_restaurant uuid;
  v_name text := btrim(coalesce(p_name, ''));
begin
  select restaurant_id into v_restaurant from public.product_variants where id = p_variant;
  if v_restaurant is null or not public.is_restaurant_owner(v_restaurant) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 60 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if p_price is null or p_price <= 0 or p_price > 99999.99 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;
  if p_available is null then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  update public.product_variants set name = v_name, price = p_price, is_available = p_available where id = p_variant;
exception
  when unique_violation then
    raise exception 'variant_duplicate' using errcode = '23505';
end;
$$;

-- STAFF também liga/desliga a disponibilidade (operação do dia a dia), sem mexer em nome nem preço.
create or replace function public.product_variant_set_available(p_variant uuid, p_available boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_restaurant uuid;
begin
  select restaurant_id into v_restaurant from public.product_variants where id = p_variant;
  if v_restaurant is null or not public.is_restaurant_member(v_restaurant) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_available is null then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  update public.product_variants set is_available = p_available where id = p_variant;
end;
$$;

create or replace function public.product_variant_delete(p_variant uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_restaurant uuid;
begin
  select restaurant_id into v_restaurant from public.product_variants where id = p_variant;
  if v_restaurant is null or not public.is_restaurant_owner(v_restaurant) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  delete from public.product_variants where id = p_variant;
end;
$$;

revoke all on function public.product_variant_create(uuid, text, numeric, boolean) from public, anon;
revoke all on function public.product_variant_update(uuid, text, numeric, boolean) from public, anon;
revoke all on function public.product_variant_set_available(uuid, boolean) from public, anon;
revoke all on function public.product_variant_delete(uuid) from public, anon;
grant execute on function public.product_variant_create(uuid, text, numeric, boolean) to authenticated;
grant execute on function public.product_variant_update(uuid, text, numeric, boolean) to authenticated;
grant execute on function public.product_variant_set_available(uuid, boolean) to authenticated;
grant execute on function public.product_variant_delete(uuid) to authenticated;

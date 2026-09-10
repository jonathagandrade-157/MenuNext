-- MenuNext — Fase 2.2: CRUD real de Produtos + vínculo com Categorias.
--
-- Inspeção prévia (schema real, projeto zsqxaxqiyqbdljsiuoho):
-- `products` tinha id, restaurant_id, name, description, price (check >= 0),
-- image_url (legado, não usado pelo sistema de imagens da Fase 1.5),
-- created_at, updated_at — sem category_id, cost, is_available ou
-- display_order. Já existia `products (id, restaurant_id) UNIQUE` (Fase
-- 1.5, usado pela FK composta de product_images). `categories` não tinha
-- `UNIQUE (id, restaurant_id)` — precisa ser adicionada para permitir a FK
-- composta products -> categories pedida nesta fase.
-- `product_images_product_id_display_order_key` existia mas NÃO era
-- deferrable — precisa virar deferrable para permitir trocar a ordem de
-- duas imagens na mesma transação (mesmo motivo de categories na Fase 2.1).
--
-- Não criamos SKU, estoque, dimensões, peso, fornecedor, marca ou
-- integrações de marketplace — fora do escopo do MenuNext (SaaS de pedidos
-- para restaurantes), conforme instruído.

-- ============================================================
-- 1. categories: constraint para suportar FK composta
-- ============================================================
alter table public.categories
  add constraint categories_id_restaurant_id_unique unique (id, restaurant_id);

-- ============================================================
-- 2. products: novas colunas
-- ============================================================
alter table public.products
  add column category_id uuid,
  add column cost numeric(10, 2),
  add column is_available boolean not null default true,
  add column display_order integer;

-- price: a regra de produto exige "obrigatório, maior que zero" — o check
-- antigo (price >= 0) permitia preço zero. Substituído por um novo check
-- (a migration antiga que criou o check original não é alterada; este é um
-- novo comando de schema, numa migration nova).
alter table public.products drop constraint products_price_check;
alter table public.products add constraint products_price_check check (price > 0);

alter table public.products
  add constraint products_cost_check check (cost is null or cost >= 0),
  add constraint products_name_length_check check (length(name) <= 120),
  add constraint products_description_length_check check (description is null or length(description) <= 500);

-- category_id não pode ser nulo (categoria é obrigatória), mas é adicionado
-- como coluna nullable e só depois marcado NOT NULL porque a tabela pode
-- ter linhas legadas sem categoria — hoje `products` está vazia (0 linhas)
-- no projeto real, então isso é seguro; caso não estivesse, teríamos que
-- reportar antes de prosseguir (ver instrução de parar diante de
-- inconsistência estrutural).
alter table public.products alter column category_id set not null;
alter table public.products alter column display_order set not null;

-- Garantia no banco (não só no frontend): category_id só pode apontar para
-- uma categoria do MESMO restaurante do produto — impossível "produto do
-- Restaurante A + categoria do Restaurante B", mesmo padrão já usado por
-- product_images -> products na Fase 1.5.
alter table public.products
  add constraint products_category_id_restaurant_id_fkey
  foreign key (category_id, restaurant_id) references public.categories (id, restaurant_id);
-- Sem "on delete cascade": isso é o que impede excluir uma categoria que
-- ainda tenha produtos (FK sem ação = RESTRICT/NO ACTION por padrão no
-- Postgres) — ver seção 13 do prompt da Fase 2.2. O server action de
-- exclusão de categoria também faz uma checagem prévia (contagem real) para
-- dar uma mensagem amigável antes de deixar o banco recusar.

create index products_restaurant_id_category_id_idx on public.products (restaurant_id, category_id);

-- Ordem é por categoria (ex.: "Pizzas: 1. Calabresa, 2. Frango"), não por
-- restaurante inteiro. Deferrable pelo mesmo motivo de categories: mover
-- para cima/baixo troca duas linhas na mesma transação.
alter table public.products
  add constraint products_category_id_display_order_key unique (category_id, display_order) deferrable initially deferred;

-- ============================================================
-- 3. product_images: tornar a unique constraint deferrable
-- ============================================================
-- Necessário para "reorganizar imagens" (trocar duas imagens de posição
-- numa única transação) — a constraint existente (Fase 1.5) não era
-- deferrable porque essa operação ainda não existia.
alter table public.product_images
  drop constraint product_images_product_id_display_order_key;
alter table public.product_images
  add constraint product_images_product_id_display_order_key
  unique (product_id, display_order) deferrable initially deferred;

-- ============================================================
-- 4. RPC: criação de produto (determina restaurant_id/display_order no
--    servidor, valida categoria do mesmo tenant)
-- ============================================================
create or replace function public.create_product(
  p_restaurant_id uuid,
  p_category_id uuid,
  p_name text,
  p_description text default null,
  p_price numeric default null,
  p_cost numeric default null,
  p_is_available boolean default true
)
returns public.products
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_name text := trim(p_name);
  v_description text := nullif(trim(coalesce(p_description, '')), '');
  v_next_order int;
  v_product public.products;
begin
  if not public.is_restaurant_member(p_restaurant_id) then
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

  insert into public.products (restaurant_id, category_id, name, description, price, cost, is_available, display_order)
  values (p_restaurant_id, p_category_id, v_name, v_description, p_price, p_cost, coalesce(p_is_available, true), v_next_order)
  returning * into v_product;

  return v_product;
end;
$$;

revoke all on function public.create_product(uuid, uuid, text, text, numeric, numeric, boolean) from public, anon;
grant execute on function public.create_product(uuid, uuid, text, text, numeric, numeric, boolean) to authenticated;

-- ============================================================
-- 5. RPC: edição de produto (revalida tenant/categoria; se a categoria
--    mudar, reposiciona a ordem no fim da nova categoria)
-- ============================================================
create or replace function public.update_product(
  p_product_id uuid,
  p_category_id uuid,
  p_name text,
  p_description text default null,
  p_price numeric default null,
  p_cost numeric default null,
  p_is_available boolean default true
)
returns public.products
language plpgsql
security definer
set search_path to 'public'
as $$
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

  if v_restaurant_id is null or not public.is_restaurant_member(v_restaurant_id) then
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
    v_next_order := null; -- sinaliza "não mexer" abaixo
  end if;

  update public.products set
    category_id = p_category_id,
    name = v_name,
    description = v_description,
    price = p_price,
    cost = p_cost,
    is_available = coalesce(p_is_available, true),
    display_order = coalesce(v_next_order, display_order)
  where id = p_product_id
  returning * into v_product;

  return v_product;
end;
$$;

revoke all on function public.update_product(uuid, uuid, text, text, numeric, numeric, boolean) from public, anon;
grant execute on function public.update_product(uuid, uuid, text, text, numeric, numeric, boolean) to authenticated;

-- ============================================================
-- 6. RPC: reordenar produto dentro da própria categoria
-- ============================================================
create or replace function public.move_product(p_product_id uuid, p_direction text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_restaurant_id uuid;
  v_category_id uuid;
  v_current_order int;
  v_neighbor_id uuid;
  v_neighbor_order int;
begin
  select restaurant_id, category_id, display_order into v_restaurant_id, v_category_id, v_current_order
  from public.products where id = p_product_id;

  if v_restaurant_id is null or not public.is_restaurant_member(v_restaurant_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_direction = 'up' then
    select id, display_order into v_neighbor_id, v_neighbor_order
    from public.products
    where category_id = v_category_id and display_order < v_current_order
    order by display_order desc limit 1;
  elsif p_direction = 'down' then
    select id, display_order into v_neighbor_id, v_neighbor_order
    from public.products
    where category_id = v_category_id and display_order > v_current_order
    order by display_order asc limit 1;
  else
    raise exception 'invalid_direction' using errcode = '22023';
  end if;

  if v_neighbor_id is null then
    return;
  end if;

  update public.products set display_order = v_neighbor_order where id = p_product_id;
  update public.products set display_order = v_current_order where id = v_neighbor_id;
end;
$$;

revoke all on function public.move_product(uuid, text) from public, anon;
grant execute on function public.move_product(uuid, text) to authenticated;

-- ============================================================
-- 7. RPC: reordenar imagem dentro do próprio produto
-- ============================================================
create or replace function public.move_product_image(p_image_id uuid, p_direction text)
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
  from public.product_images where id = p_image_id;

  if v_restaurant_id is null or not public.is_restaurant_member(v_restaurant_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_direction = 'up' then
    select id, display_order into v_neighbor_id, v_neighbor_order
    from public.product_images
    where product_id = v_product_id and display_order < v_current_order
    order by display_order desc limit 1;
  elsif p_direction = 'down' then
    select id, display_order into v_neighbor_id, v_neighbor_order
    from public.product_images
    where product_id = v_product_id and display_order > v_current_order
    order by display_order asc limit 1;
  else
    raise exception 'invalid_direction' using errcode = '22023';
  end if;

  if v_neighbor_id is null then
    return;
  end if;

  update public.product_images set display_order = v_neighbor_order where id = p_image_id;
  update public.product_images set display_order = v_current_order where id = v_neighbor_id;
end;
$$;

revoke all on function public.move_product_image(uuid, text) from public, anon;
grant execute on function public.move_product_image(uuid, text) to authenticated;

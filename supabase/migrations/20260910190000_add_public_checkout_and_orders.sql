-- MenuNext — Fase 3.3: checkout público + criação segura de pedidos (guest).
--
-- Inspeção prévia: não existia NENHUMA tabela de pedido no schema (orders,
-- order_items etc.). A sacola (src/lib/bag.ts) é inteiramente local/client
-- (localStorage), sem contrapartida no banco — o comentário do próprio
-- arquivo já avisava que "a criação segura do pedido deve recalcular tudo
-- no servidor a partir dos preços reais em banco". É isso que esta migration
-- resolve: o cliente (guest, sem login) envia só uma INTENÇÃO de compra
-- (product_id/quantity/addon_ids/observation) e o servidor reconstrói
-- preço, adicionais e total a partir do banco.
--
-- Reaproveita os padrões já estabelecidos no projeto:
-- - RPC SECURITY DEFINER com search_path fixo para toda escrita que precisa
--   determinar valores no servidor (mesmo padrão de create_restaurant,
--   create_product, create_addon_group...).
-- - is_restaurant_publicly_visible()/is_restaurant_member() para as duas
--   pontas (cliente anônimo cria; lojista lê).
-- - Nenhuma tabela nova tem policy de INSERT/UPDATE para anon/authenticated:
--   toda escrita passa pela RPC (dono postgres, que já bypassa RLS como
--   owner das tabelas) — mesmo mecanismo de restaurant_members na Sprint 1
--   (só a RPC create_restaurant escreve lá).
-- - FK snapshot: order_items/order_item_addons guardam nome/preço no
--   momento da compra (product_name/unit_price, addon_name/unit_price) —
--   se o produto for excluído depois, o pedido antigo continua correto
--   (por isso product_id/addon_id são NULLABLE com ON DELETE SET NULL, em
--   vez da FK composta "on delete restrict" usada em addons/addon_groups:
--   aqui queremos preservar histórico, não bloquear exclusão).
--
-- Fora de escopo desta fase (arquitetura deixada preparada, não implementada):
-- KDS, impressão, WhatsApp automático, gateway de pagamento, cupons,
-- fidelidade, mesas/comandas, login do cliente, estoque, nota fiscal. A
-- máquina de estados (`status`) já cobre o fluxo completo de entrega e
-- retirada para quando o Kanban (painel/pedidos, painel/kds) for
-- implementado — nenhuma segunda máquina de estados deve ser criada depois.

-- ============================================================
-- 1. order_counters — contador sequencial por restaurante (código visual
--    "#1048"). Tabela separada (não uma coluna em restaurants) para que o
--    incremento atômico (UPDATE ... RETURNING, serializado pelo lock de
--    linha do Postgres) fique isolado da tabela principal do restaurante.
--    NENHUMA policy: só a RPC (dono postgres) toca aqui.
-- ============================================================
create table public.order_counters (
  restaurant_id uuid primary key references public.restaurants (id) on delete cascade,
  last_order_number integer not null default 0
);

alter table public.order_counters enable row level security;

-- ============================================================
-- 2. orders
-- ============================================================
-- public_id: identificador de rastreamento público (UUID, não sequencial,
-- não adivinhável) — usado na URL /loja/[slug]/pedido/[public_id]. Nunca o
-- mesmo valor que `id` por acidente de uso: são colunas distintas de
-- propósito, mesmo ambas UUID, para deixar claro que `id` é interno.
-- order_number: só um rótulo amigável ("Pedido #1048"), nunca usado para
-- buscar pedido (não é chave de acesso) — combinado com slug+public_id em
-- get_public_order, nunca sozinho.
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  public_id uuid not null unique default gen_random_uuid(),
  order_number integer not null,

  customer_name text not null check (length(trim(customer_name)) between 1 and 120),
  customer_phone text not null check (length(regexp_replace(customer_phone, '\D', '', 'g')) between 10 and 11),

  fulfillment_type text not null check (fulfillment_type in ('delivery', 'pickup')),

  delivery_zip text,
  delivery_street text,
  delivery_number text,
  delivery_complement text,
  delivery_neighborhood text,
  delivery_city text,
  delivery_state text,
  delivery_reference text,

  payment_method text not null check (payment_method in ('pix', 'cash', 'card')),
  change_for numeric(10, 2) check (change_for is null or change_for >= 0),

  observation text check (observation is null or length(observation) <= 300),

  subtotal numeric(10, 2) not null check (subtotal >= 0),
  delivery_fee numeric(10, 2) not null default 0 check (delivery_fee >= 0),
  total numeric(10, 2) not null check (total >= 0),

  status text not null default 'received',

  idempotency_key text not null check (length(idempotency_key) between 1 and 100),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (restaurant_id, order_number),
  unique (restaurant_id, idempotency_key),

  -- Total sempre consistente com subtotal + entrega — nunca confiar em um
  -- total enviado separadamente sem essa relação valer.
  check (total = subtotal + delivery_fee),

  -- Retirada nunca carrega endereço de entrega (o servidor força null,
  -- este check é a segunda linha de defesa); entrega sempre exige os
  -- campos mínimos de endereço.
  check (
    (fulfillment_type = 'pickup' and delivery_street is null and delivery_number is null
      and delivery_neighborhood is null and delivery_city is null)
    or
    (fulfillment_type = 'delivery' and delivery_street is not null and length(trim(delivery_street)) > 0
      and delivery_number is not null and length(trim(delivery_number)) > 0
      and delivery_neighborhood is not null and length(trim(delivery_neighborhood)) > 0
      and delivery_city is not null and length(trim(delivery_city)) > 0)
  ),

  -- Retirada nunca tem taxa de entrega.
  check (fulfillment_type = 'delivery' or delivery_fee = 0),

  -- "Troco para" só faz sentido em dinheiro, e nunca pode ser menor que o total.
  check (payment_method = 'cash' or change_for is null),
  check (change_for is null or change_for >= total),

  -- Máquina de estados reaproveitada do fluxo de entrega/retirada (item 8 do
  -- prompt da Fase 3.3) — cada modalidade só transita pelos status que
  -- fazem sentido para ela. `cancelled` vale para as duas (pedido pode ser
  -- cancelado em qualquer ponto antes da conclusão).
  check (
    (fulfillment_type = 'delivery'
      and status in ('received', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'))
    or
    (fulfillment_type = 'pickup'
      and status in ('received', 'confirmed', 'preparing', 'ready', 'picked_up', 'cancelled'))
  )
);

create index orders_restaurant_id_idx on public.orders (restaurant_id);
create index orders_restaurant_id_status_idx on public.orders (restaurant_id, status);

create trigger set_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

alter table public.orders enable row level security;

-- Só o lojista (membro) lê os próprios pedidos — preparado para o Kanban
-- (painel/pedidos, painel/kds) de uma fase futura. Sem policy de
-- INSERT/UPDATE/DELETE para authenticated/anon: toda escrita é feita pela
-- RPC create_order (SECURITY DEFINER, dono postgres). O cliente anônimo
-- NUNCA tem acesso direto a esta tabela — leitura pública de um pedido
-- específico é feita só pela RPC get_public_order, que devolve apenas os
-- campos necessários (nunca a linha inteira, nunca outros pedidos).
create policy "orders_select_members" on public.orders
  for select to authenticated using (public.is_restaurant_member(restaurant_id));

-- ============================================================
-- 3. order_items — snapshot dos produtos comprados.
-- ============================================================
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,

  product_name text not null check (length(trim(product_name)) > 0),
  unit_price numeric(10, 2) not null check (unit_price >= 0),
  quantity integer not null check (quantity between 1 and 99),
  observation text check (observation is null or length(observation) <= 200),
  subtotal numeric(10, 2) not null check (subtotal >= 0),

  created_at timestamptz not null default now()
);

create index order_items_restaurant_id_idx on public.order_items (restaurant_id);
create index order_items_order_id_idx on public.order_items (order_id);

alter table public.order_items enable row level security;

create policy "order_items_select_members" on public.order_items
  for select to authenticated using (public.is_restaurant_member(restaurant_id));

-- ============================================================
-- 4. order_item_addons — snapshot dos adicionais escolhidos por item.
-- ============================================================
create table public.order_item_addons (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  addon_id uuid references public.addons (id) on delete set null,

  addon_name text not null check (length(trim(addon_name)) > 0),
  unit_price numeric(10, 2) not null check (unit_price >= 0),
  subtotal numeric(10, 2) not null check (subtotal >= 0),

  created_at timestamptz not null default now()
);

create index order_item_addons_restaurant_id_idx on public.order_item_addons (restaurant_id);
create index order_item_addons_order_item_id_idx on public.order_item_addons (order_item_id);

alter table public.order_item_addons enable row level security;

create policy "order_item_addons_select_members" on public.order_item_addons
  for select to authenticated using (public.is_restaurant_member(restaurant_id));

-- ============================================================
-- 5. get_public_restaurant_by_slug — estendida (Fase 3.3) para incluir os
--    booleans de forma de pagamento aceita (payment_pix/payment_cash/
--    payment_card). O checkout precisa saber QUAIS formas oferecer, mas
--    NUNCA a chave Pix nesse momento — a chave só é exposta depois de o
--    pedido existir, por get_public_order, e só quando payment_method =
--    'pix' (item 12 do prompt: "não expor informações administrativas
--    desnecessárias do restaurante" / "usar a chave Pix somente no
--    momento apropriado"). Precisa DROP porque o tipo de retorno muda.
-- ============================================================
drop function public.get_public_restaurant_by_slug(text);

create function public.get_public_restaurant_by_slug(p_slug text)
returns table (
  id uuid,
  name text,
  slug text,
  status text,
  onboarding_completed boolean,
  logo_path text,
  cover_path text,
  service_delivery boolean,
  service_pickup boolean,
  delivery_fee numeric,
  delivery_radius_km numeric,
  payment_pix boolean,
  payment_cash boolean,
  payment_card boolean
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select r.id, r.name, r.slug, r.status, r.onboarding_completed, r.logo_path, r.cover_path,
         r.service_delivery, r.service_pickup, r.delivery_fee, r.delivery_radius_km,
         r.payment_pix, r.payment_cash, r.payment_card
  from public.restaurants r
  where r.slug = p_slug
    and r.onboarding_completed = true;
$$;

revoke all on function public.get_public_restaurant_by_slug(text) from public;
grant execute on function public.get_public_restaurant_by_slug(text) to anon, authenticated;

-- ============================================================
-- 6. create_order — RPC transacional/segura (o corpo inteiro de uma função
--    plpgsql já é atômico: qualquer exceção desfaz TUDO que a função já
--    tinha feito, sem precisar de BEGIN/COMMIT manual).
--
--    O cliente manda só uma intenção de compra: p_items é um jsonb array
--    de {product_id, quantity, observation, addon_ids}. NENHUM preço,
--    subtotal, total, taxa de entrega ou restaurant_id vem do cliente —
--    o restaurante é resolvido pelo slug (nunca aceito solto) e todo
--    preço vem de uma nova leitura de products/addons, dentro da mesma
--    transação.
--
--    Idempotência: p_idempotency_key é gerado no cliente (sessionStorage,
--    ver src/lib/actions/orders.ts) e validado aqui via UNIQUE
--    (restaurant_id, idempotency_key). Um reenvio com a mesma chave (duplo
--    clique, reload, retry de rede) devolve o MESMO pedido já criado, em
--    vez de duplicar ou falhar — checado logo no início (fast path) e de
--    novo no EXCEPTION (fallback para a corrida rara de duas requisições
--    concorrentes passando pelo fast path ao mesmo tempo).
-- ============================================================
create or replace function public.create_order(
  p_slug text,
  p_customer_name text,
  p_customer_phone text,
  p_fulfillment_type text,
  p_payment_method text,
  p_items jsonb,
  p_idempotency_key text,
  p_delivery_zip text default null,
  p_delivery_street text default null,
  p_delivery_number text default null,
  p_delivery_complement text default null,
  p_delivery_neighborhood text default null,
  p_delivery_city text default null,
  p_delivery_state text default null,
  p_delivery_reference text default null,
  p_change_for numeric default null,
  p_observation text default null
)
returns table (
  public_id uuid,
  order_number integer,
  status text,
  fulfillment_type text,
  payment_method text,
  subtotal numeric,
  delivery_fee numeric,
  total numeric,
  created_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_restaurant record;
  v_existing_order_id uuid;
  v_customer_name text := trim(p_customer_name);
  v_customer_phone text := trim(p_customer_phone);
  v_idempotency_key text := trim(coalesce(p_idempotency_key, ''));
  v_observation text := nullif(trim(coalesce(p_observation, '')), '');
  v_delivery_street text;
  v_delivery_number text;
  v_delivery_complement text;
  v_delivery_neighborhood text;
  v_delivery_city text;
  v_delivery_state text;
  v_delivery_zip text;
  v_delivery_reference text;
  v_change_for numeric;
  v_delivery_fee numeric(10, 2) := 0;
  v_subtotal numeric(10, 2) := 0;
  v_total numeric(10, 2);
  v_now timestamptz := now();
  v_today_hours record;
  v_now_local time;
  v_is_open boolean := false;
  v_order_id uuid;
  v_order_public_id uuid;
  v_order_number integer;
  v_item jsonb;
  v_item_count integer := 0;
  v_product record;
  v_addon_ids jsonb;
  v_addon_id_text text;
  v_addon record;
  v_quantity integer;
  v_item_observation text;
  v_item_subtotal numeric(10, 2);
  v_group_counts jsonb;
  v_group record;
  v_selected_count integer;
  v_item_id uuid;
begin
  -- 1) Restaurante resolvido SÓ pelo slug — nunca aceito como id solto.
  select r.id, r.status, r.onboarding_completed, r.service_delivery, r.service_pickup, r.delivery_fee
  into v_restaurant
  from public.restaurants r
  where r.slug = lower(trim(p_slug));

  if v_restaurant.id is null or v_restaurant.onboarding_completed is not true then
    raise exception 'restaurant_not_found' using errcode = '22023';
  end if;

  if v_idempotency_key = '' then
    raise exception 'invalid_idempotency_key' using errcode = '22023';
  end if;

  -- 2) Idempotência (fast path): mesma chave + mesmo restaurante já criou
  --    pedido -> devolve o existente em vez de recriar ou falhar.
  select o.id into v_existing_order_id
  from public.orders o
  where o.restaurant_id = v_restaurant.id and o.idempotency_key = v_idempotency_key;

  if v_existing_order_id is not null then
    return query
      select o.public_id, o.order_number, o.status, o.fulfillment_type, o.payment_method,
             o.subtotal, o.delivery_fee, o.total, o.created_at
      from public.orders o where o.id = v_existing_order_id;
    return;
  end if;

  -- 3) Restaurante precisa estar ativo E dentro do horário de
  --    funcionamento configurado (mesma regra de computeStoreOpenState em
  --    src/lib/store.ts — só "open" permite pedido; "paused"/"closed"/
  --    "draft"/fora do horário bloqueiam). Sem timezone armazenada no
  --    schema; America/Sao_Paulo é o fuso do mercado do produto.
  if v_restaurant.status <> 'active' then
    raise exception 'restaurant_unavailable' using errcode = '22023';
  end if;

  v_now_local := (v_now at time zone 'America/Sao_Paulo')::time;

  select bh.is_open, bh.opens_at, bh.closes_at into v_today_hours
  from public.business_hours bh
  where bh.restaurant_id = v_restaurant.id
    and bh.day_of_week = extract(dow from (v_now at time zone 'America/Sao_Paulo'))::smallint;

  if v_today_hours.is_open is true and v_today_hours.opens_at is not null and v_today_hours.closes_at is not null then
    if v_today_hours.closes_at > v_today_hours.opens_at then
      v_is_open := v_now_local >= v_today_hours.opens_at and v_now_local < v_today_hours.closes_at;
    else
      v_is_open := v_now_local >= v_today_hours.opens_at or v_now_local < v_today_hours.closes_at;
    end if;
  end if;

  if not v_is_open then
    raise exception 'restaurant_closed' using errcode = '22023';
  end if;

  -- 4) Dados do cliente (guest — sem conta, sem CPF, só o necessário).
  if v_customer_name = '' or length(v_customer_name) > 120 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if length(regexp_replace(v_customer_phone, '\D', '', 'g')) not between 10 and 11 then
    raise exception 'invalid_phone' using errcode = '22023';
  end if;

  -- 5) Entrega ou retirada — validado contra o que o restaurante
  --    realmente oferece, nunca só aceito porque o cliente mandou.
  if p_fulfillment_type not in ('delivery', 'pickup') then
    raise exception 'invalid_fulfillment_type' using errcode = '22023';
  end if;

  if p_fulfillment_type = 'delivery' then
    if v_restaurant.service_delivery is not true then
      raise exception 'delivery_not_available' using errcode = '22023';
    end if;
    v_delivery_street := nullif(trim(coalesce(p_delivery_street, '')), '');
    v_delivery_number := nullif(trim(coalesce(p_delivery_number, '')), '');
    v_delivery_neighborhood := nullif(trim(coalesce(p_delivery_neighborhood, '')), '');
    v_delivery_city := nullif(trim(coalesce(p_delivery_city, '')), '');
    if v_delivery_street is null or v_delivery_number is null or v_delivery_neighborhood is null or v_delivery_city is null then
      raise exception 'invalid_address' using errcode = '22023';
    end if;
    v_delivery_complement := nullif(trim(coalesce(p_delivery_complement, '')), '');
    v_delivery_state := nullif(trim(coalesce(p_delivery_state, '')), '');
    v_delivery_zip := nullif(trim(coalesce(p_delivery_zip, '')), '');
    v_delivery_reference := nullif(trim(coalesce(p_delivery_reference, '')), '');
    v_delivery_fee := coalesce(v_restaurant.delivery_fee, 0);
  else
    if v_restaurant.service_pickup is not true then
      raise exception 'pickup_not_available' using errcode = '22023';
    end if;
    -- Retirada nunca carrega endereço, mesmo que o cliente tenha mandado algo.
    v_delivery_street := null;
    v_delivery_number := null;
    v_delivery_complement := null;
    v_delivery_neighborhood := null;
    v_delivery_city := null;
    v_delivery_state := null;
    v_delivery_zip := null;
    v_delivery_reference := null;
    v_delivery_fee := 0;
  end if;

  -- 6) Pagamento — só o que o restaurante configurou aceitar.
  if p_payment_method not in ('pix', 'cash', 'card') then
    raise exception 'invalid_payment_method' using errcode = '22023';
  end if;
  if p_payment_method = 'cash' then
    v_change_for := p_change_for;
  else
    v_change_for := null;
  end if;

  if v_observation is not null and length(v_observation) > 300 then
    raise exception 'observation_too_long' using errcode = '22023';
  end if;

  -- 7) Itens — nunca vazio.
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_cart' using errcode = '22023';
  end if;

  -- 8) Passagem 1: valida cada item/adicional contra o banco REAL e soma
  --    o subtotal. Preço sempre lido de products/addons — nunca do
  --    cliente. Cada produto/adicional é buscado SEMPRE filtrando por
  --    restaurant_id = v_restaurant.id (nunca só por id), o que blinda
  --    contra produto/adicional de outro restaurante mesmo que o cliente
  --    manipule os IDs manualmente.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_count := v_item_count + 1;

    begin
      v_quantity := (v_item ->> 'quantity')::integer;
    exception when others then
      raise exception 'invalid_items' using errcode = '22023';
    end;
    if v_quantity is null or v_quantity < 1 or v_quantity > 99 then
      raise exception 'invalid_quantity' using errcode = '22023';
    end if;

    v_item_observation := nullif(trim(coalesce(v_item ->> 'observation', '')), '');
    if v_item_observation is not null and length(v_item_observation) > 200 then
      raise exception 'observation_too_long' using errcode = '22023';
    end if;

    begin
      select p.id, p.name, p.price, p.is_available
      into v_product
      from public.products p
      where p.id = (v_item ->> 'product_id')::uuid and p.restaurant_id = v_restaurant.id;
    exception when others then
      raise exception 'invalid_items' using errcode = '22023';
    end;

    if v_product.id is null then
      raise exception 'product_not_found' using errcode = '22023';
    end if;
    if v_product.is_available is not true then
      raise exception 'product_unavailable' using errcode = '22023';
    end if;

    v_item_subtotal := v_product.price * v_quantity;

    -- Contagem de selecionados por grupo (só para validar min/max/required
    -- dos grupos ATIVOS associados a este produto — grupo inativo nunca
    -- aparece pro público, então nem pode ter sido selecionado por um
    -- cliente que só usa a UI; ainda assim, um addon_id de grupo inativo
    -- enviado manualmente é rejeitado abaixo, no loop de adicionais).
    v_group_counts := '{}'::jsonb;

    v_addon_ids := coalesce(v_item -> 'addon_ids', '[]'::jsonb);
    if jsonb_typeof(v_addon_ids) <> 'array' then
      raise exception 'invalid_items' using errcode = '22023';
    end if;

    for v_addon_id_text in select jsonb_array_elements_text(v_addon_ids)
    loop
      begin
        select a.id, a.name, a.price, a.is_available, a.addon_group_id, g.is_active as group_is_active
        into v_addon
        from public.addons a
        join public.addon_groups g on g.id = a.addon_group_id
        where a.id = v_addon_id_text::uuid and a.restaurant_id = v_restaurant.id;
      exception when others then
        raise exception 'invalid_items' using errcode = '22023';
      end;

      if v_addon.id is null then
        raise exception 'addon_not_found' using errcode = '22023';
      end if;
      if v_addon.is_available is not true then
        raise exception 'addon_unavailable' using errcode = '22023';
      end if;
      if v_addon.group_is_active is not true then
        raise exception 'addon_group_inactive' using errcode = '22023';
      end if;
      if not exists (
        select 1 from public.product_addon_groups pag
        where pag.product_id = v_product.id and pag.addon_group_id = v_addon.addon_group_id
      ) then
        raise exception 'addon_not_linked_to_product' using errcode = '22023';
      end if;

      v_item_subtotal := v_item_subtotal + (v_addon.price * v_quantity);
      v_group_counts := jsonb_set(
        v_group_counts,
        array[v_addon.addon_group_id::text],
        to_jsonb(coalesce((v_group_counts ->> v_addon.addon_group_id::text)::integer, 0) + 1)
      );
    end loop;

    -- Min/max/obrigatório dos grupos ATIVOS associados ao produto — mesma
    -- regra de src/lib/bag.ts:validateGroupSelection, agora no servidor.
    for v_group in
      select g.id, g.name, g.min_selections, g.max_selections, g.is_required
      from public.product_addon_groups pag
      join public.addon_groups g on g.id = pag.addon_group_id
      where pag.product_id = v_product.id and g.is_active = true
    loop
      v_selected_count := coalesce((v_group_counts ->> v_group.id::text)::integer, 0);
      if v_selected_count > v_group.max_selections or v_selected_count < v_group.min_selections then
        raise exception 'addon_group_selection_invalid' using errcode = '22023';
      end if;
    end loop;

    v_subtotal := v_subtotal + v_item_subtotal;
  end loop;

  -- 9) Total sempre calculado no servidor — nunca aceito do cliente.
  v_total := v_subtotal + v_delivery_fee;

  if v_change_for is not null and v_change_for < v_total then
    raise exception 'invalid_change' using errcode = '22023';
  end if;

  -- 10) Número sequencial (#1048) — incremento atômico via UPDATE...RETURNING
  --     (serializado pelo lock de linha do Postgres; sem race entre pedidos
  --     concorrentes do mesmo restaurante).
  insert into public.order_counters (restaurant_id) values (v_restaurant.id)
    on conflict (restaurant_id) do nothing;

  update public.order_counters
  set last_order_number = last_order_number + 1
  where restaurant_id = v_restaurant.id
  returning last_order_number into v_order_number;

  -- 11) Cria o pedido + itens + adicionais dentro da MESMA transação
  --     implícita da função: se qualquer INSERT abaixo falhar, tudo é
  --     desfeito (nenhum pedido "órfão" sem itens, nenhum total
  --     inconsistente).
  insert into public.orders as o (
    restaurant_id, public_id, order_number, customer_name, customer_phone, fulfillment_type,
    delivery_zip, delivery_street, delivery_number, delivery_complement, delivery_neighborhood,
    delivery_city, delivery_state, delivery_reference,
    payment_method, change_for, observation, subtotal, delivery_fee, total, status, idempotency_key
  )
  values (
    v_restaurant.id, gen_random_uuid(), v_order_number, v_customer_name, v_customer_phone, p_fulfillment_type,
    v_delivery_zip, v_delivery_street, v_delivery_number, v_delivery_complement, v_delivery_neighborhood,
    v_delivery_city, v_delivery_state, v_delivery_reference,
    p_payment_method, v_change_for, v_observation, v_subtotal, v_delivery_fee, v_total, 'received', v_idempotency_key
  )
  -- `public_id` sozinho aqui é ambíguo: RETURNS TABLE(public_id uuid, ...)
  -- desta função declara implicitamente uma variável de saída chamada
  -- `public_id`, que colide com a coluna `orders.public_id` no RETURNING.
  -- O alias `o` desfaz a ambiguidade (bug real encontrado na validação
  -- LIVE — ver migration fix_create_order_public_id_ambiguity.sql).
  returning o.id, o.public_id into v_order_id, v_order_public_id;

  -- 12) Passagem 2: repete a leitura (mesma transação, dados não podem ter
  --     mudado) para inserir order_items/order_item_addons já validados.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_quantity := (v_item ->> 'quantity')::integer;
    v_item_observation := nullif(trim(coalesce(v_item ->> 'observation', '')), '');

    select p.id, p.name, p.price into v_product
    from public.products p
    where p.id = (v_item ->> 'product_id')::uuid and p.restaurant_id = v_restaurant.id;

    insert into public.order_items (restaurant_id, order_id, product_id, product_name, unit_price, quantity, observation, subtotal)
    values (v_restaurant.id, v_order_id, v_product.id, v_product.name, v_product.price, v_quantity, v_item_observation, v_product.price * v_quantity)
    returning id into v_item_id;

    v_addon_ids := coalesce(v_item -> 'addon_ids', '[]'::jsonb);
    for v_addon_id_text in select jsonb_array_elements_text(v_addon_ids)
    loop
      select a.id, a.name, a.price into v_addon
      from public.addons a
      where a.id = v_addon_id_text::uuid and a.restaurant_id = v_restaurant.id;

      insert into public.order_item_addons (restaurant_id, order_item_id, addon_id, addon_name, unit_price, subtotal)
      values (v_restaurant.id, v_item_id, v_addon.id, v_addon.name, v_addon.price, v_addon.price * v_quantity);
    end loop;
  end loop;

  return query
    select v_order_public_id, v_order_number, 'received'::text, p_fulfillment_type, p_payment_method,
           v_subtotal, v_delivery_fee, v_total, v_now;
exception
  -- Corrida rara: duas requisições com a MESMA idempotency_key passaram
  -- pelo fast path do passo 2 ao mesmo tempo. A constraint UNIQUE
  -- (restaurant_id, idempotency_key) barra a segunda gravação — em vez de
  -- devolver erro pro cliente, devolve o pedido que a outra já criou
  -- (mesma garantia de "nunca duplica", só que resolvida aqui).
  when unique_violation then
    return query
      select o.public_id, o.order_number, o.status, o.fulfillment_type, o.payment_method,
             o.subtotal, o.delivery_fee, o.total, o.created_at
      from public.orders o
      where o.restaurant_id = v_restaurant.id and o.idempotency_key = v_idempotency_key;
end;
$$;

revoke all on function public.create_order(
  text, text, text, text, text, jsonb, text, text, text, text, text, text, text, text, text, numeric, text
) from public;
grant execute on function public.create_order(
  text, text, text, text, text, jsonb, text, text, text, text, text, text, text, text, text, numeric, text
) to anon, authenticated;

-- ============================================================
-- 7. get_public_order — leitura pública de UM pedido para a tela de
--    confirmação/rastreamento (item 16 do prompt: nunca uma policy de
--    SELECT irrestrita pra anon em orders; só esta RPC, amarrada a
--    slug+public_id ao mesmo tempo, devolvendo apenas os campos
--    necessários). A chave Pix do restaurante só é incluída quando
--    payment_method = 'pix' do PRÓPRIO pedido — nunca antes de o pedido
--    existir, nunca vinda do cliente.
-- ============================================================
create or replace function public.get_public_order(p_slug text, p_public_id uuid)
returns table (
  public_id uuid,
  order_number integer,
  status text,
  fulfillment_type text,
  payment_method text,
  change_for numeric,
  customer_name text,
  customer_phone text,
  delivery_zip text,
  delivery_street text,
  delivery_number text,
  delivery_complement text,
  delivery_neighborhood text,
  delivery_city text,
  delivery_state text,
  delivery_reference text,
  observation text,
  subtotal numeric,
  delivery_fee numeric,
  total numeric,
  created_at timestamptz,
  restaurant_name text,
  pix_key text,
  items jsonb
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    o.public_id, o.order_number, o.status, o.fulfillment_type, o.payment_method, o.change_for,
    o.customer_name, o.customer_phone,
    o.delivery_zip, o.delivery_street, o.delivery_number, o.delivery_complement, o.delivery_neighborhood,
    o.delivery_city, o.delivery_state, o.delivery_reference,
    o.observation, o.subtotal, o.delivery_fee, o.total, o.created_at,
    r.name as restaurant_name,
    case when o.payment_method = 'pix' then r.payment_pix_key else null end as pix_key,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_name', oi.product_name,
        'unit_price', oi.unit_price,
        'quantity', oi.quantity,
        'observation', oi.observation,
        'subtotal', oi.subtotal,
        'addons', coalesce((
          select jsonb_agg(jsonb_build_object(
            'addon_name', oia.addon_name,
            'unit_price', oia.unit_price,
            'subtotal', oia.subtotal
          ) order by oia.created_at)
          from public.order_item_addons oia
          where oia.order_item_id = oi.id
        ), '[]'::jsonb)
      ) order by oi.created_at)
      from public.order_items oi
      where oi.order_id = o.id
    ), '[]'::jsonb) as items
  from public.orders o
  join public.restaurants r on r.id = o.restaurant_id
  where r.slug = p_slug and o.public_id = p_public_id;
$$;

revoke all on function public.get_public_order(text, uuid) from public;
grant execute on function public.get_public_order(text, uuid) to anon, authenticated;

-- Fase 4.1.1 — Frete + checkout final.
--
-- 1) delivery_fee_method ('fixed' | 'per_km') controla como delivery_fee é
--    interpretado — reaproveita a coluna existente (fixed: valor da taxa;
--    per_km: valor por km) em vez de duplicar um novo campo de "taxa" só
--    para o método por km.
-- 2) latitude/longitude cacheiam a geocodificação do ENDEREÇO DO
--    RESTAURANTE (já existente em address_street/number/... desde o
--    onboarding) — feita uma vez no servidor Next.js (nunca dentro do
--    Postgres, que não tem acesso a rede) quando o lojista ativa "por km"
--    em /painel/delivery. Nulas enquanto o restaurante usa taxa fixa sem
--    raio configurado (nenhuma geocodificação é necessária nesse caso).
-- 3) orders.delivery_distance_km grava a distância usada para calcular o
--    frete daquele pedido específico (auditoria/exibição — nunca a fonte de
--    verdade do cálculo em si, que já aconteceu antes de chegar aqui).
-- 4) create_order passa a aceitar p_delivery_distance_km (calculado no
--    servidor Next.js via geocoding, nunca no navegador) e:
--    - SEMPRE valida contra delivery_radius_km quando configurado (mesmo
--      com taxa fixa — "se existir raio máximo, continuar respeitando");
--    - só usa a distância na fórmula do frete quando o método é 'per_km';
--    - nunca aceita um delivery_fee vindo do cliente — isso já não existia
--      antes desta migration e continua não existindo agora.

alter table public.restaurants
  add column delivery_fee_method text not null default 'fixed',
  add column latitude numeric(9, 6),
  add column longitude numeric(9, 6);

alter table public.restaurants
  add constraint restaurants_delivery_fee_method_check check (delivery_fee_method in ('fixed', 'per_km'));

alter table public.orders
  add column delivery_distance_km numeric(6, 2);

alter table public.orders
  add constraint orders_delivery_distance_km_check check (delivery_distance_km is null or delivery_distance_km >= 0);

-- ---------------------------------------------------------------------------
-- create_order — mesma definição da migration add_delivery_config_and_cancellation.sql,
-- com duas adições: parâmetro p_delivery_distance_km e a validação de
-- raio/frete por km logo onde v_delivery_fee era calculado.
-- ---------------------------------------------------------------------------
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
  p_observation text default null,
  p_delivery_distance_km numeric default null
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
as $function$
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
  v_delivery_distance_km numeric(6, 2);
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
  select r.id, r.status, r.onboarding_completed, r.service_delivery, r.service_pickup, r.delivery_fee,
         r.minimum_order_value, r.delivery_fee_method, r.delivery_radius_km
  into v_restaurant
  from public.restaurants r
  where r.slug = lower(trim(p_slug));

  if v_restaurant.id is null or v_restaurant.onboarding_completed is not true then
    raise exception 'restaurant_not_found' using errcode = '22023';
  end if;

  if v_idempotency_key = '' then
    raise exception 'invalid_idempotency_key' using errcode = '22023';
  end if;

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

  if v_customer_name = '' or length(v_customer_name) > 120 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if length(regexp_replace(v_customer_phone, '\D', '', 'g')) not between 10 and 11 then
    raise exception 'invalid_phone' using errcode = '22023';
  end if;

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

    -- Frete por distância (Fase 4.1.1): a distância em si já vem calculada
    -- (geocoding acontece no servidor Next.js, nunca aqui — Postgres não
    -- geocodifica). Esta RPC continua sendo a fonte de verdade sobre a
    -- FÓRMULA do frete e sobre o raio máximo, em qualquer método.
    if v_restaurant.delivery_radius_km is not null or v_restaurant.delivery_fee_method = 'per_km' then
      if p_delivery_distance_km is null or p_delivery_distance_km < 0 then
        raise exception 'invalid_distance' using errcode = '22023';
      end if;
      if v_restaurant.delivery_radius_km is not null and p_delivery_distance_km > v_restaurant.delivery_radius_km then
        raise exception 'address_out_of_range' using errcode = '22023';
      end if;
      v_delivery_distance_km := p_delivery_distance_km;
    end if;

    if v_restaurant.delivery_fee_method = 'per_km' then
      v_delivery_fee := round(coalesce(v_restaurant.delivery_fee, 0) * p_delivery_distance_km, 2);
    else
      v_delivery_fee := coalesce(v_restaurant.delivery_fee, 0);
    end if;
  else
    if v_restaurant.service_pickup is not true then
      raise exception 'pickup_not_available' using errcode = '22023';
    end if;
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

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_cart' using errcode = '22023';
  end if;

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

  if p_fulfillment_type = 'delivery' and v_restaurant.minimum_order_value is not null
     and v_subtotal < v_restaurant.minimum_order_value then
    raise exception 'below_minimum_order' using errcode = '22023';
  end if;

  v_total := v_subtotal + v_delivery_fee;

  if v_change_for is not null and v_change_for < v_total then
    raise exception 'invalid_change' using errcode = '22023';
  end if;

  insert into public.order_counters (restaurant_id) values (v_restaurant.id)
    on conflict (restaurant_id) do nothing;

  update public.order_counters
  set last_order_number = last_order_number + 1
  where restaurant_id = v_restaurant.id
  returning last_order_number into v_order_number;

  insert into public.orders as o (
    restaurant_id, public_id, order_number, customer_name, customer_phone, fulfillment_type,
    delivery_zip, delivery_street, delivery_number, delivery_complement, delivery_neighborhood,
    delivery_city, delivery_state, delivery_reference, delivery_distance_km,
    payment_method, change_for, observation, subtotal, delivery_fee, total, status, idempotency_key
  )
  values (
    v_restaurant.id, gen_random_uuid(), v_order_number, v_customer_name, v_customer_phone, p_fulfillment_type,
    v_delivery_zip, v_delivery_street, v_delivery_number, v_delivery_complement, v_delivery_neighborhood,
    v_delivery_city, v_delivery_state, v_delivery_reference, v_delivery_distance_km,
    p_payment_method, v_change_for, v_observation, v_subtotal, v_delivery_fee, v_total, 'received', v_idempotency_key
  )
  returning o.id, o.public_id into v_order_id, v_order_public_id;

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
  when unique_violation then
    return query
      select o.public_id, o.order_number, o.status, o.fulfillment_type, o.payment_method,
             o.subtotal, o.delivery_fee, o.total, o.created_at
      from public.orders o
      where o.restaurant_id = v_restaurant.id and o.idempotency_key = v_idempotency_key;
end;
$function$;

-- ---------------------------------------------------------------------------
-- get_public_restaurant_by_slug — adiciona delivery_fee_method/latitude/
-- longitude (localização do próprio restaurante não é dado sensível — é a
-- mesma informação que apareceria num mapa da loja). DROP+CREATE porque
-- RETURNS TABLE muda (mesma limitação de create or replace já documentada
-- na migration expose_delivery_fields_public_restaurant.sql).
-- ---------------------------------------------------------------------------
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
  delivery_fee_method text,
  latitude numeric,
  longitude numeric,
  minimum_order_value numeric,
  estimated_delivery_min_minutes integer,
  estimated_delivery_max_minutes integer,
  payment_pix boolean,
  payment_cash boolean,
  payment_card boolean
)
language sql
stable security definer
set search_path to 'public'
as $function$
  select r.id, r.name, r.slug, r.status, r.onboarding_completed, r.logo_path, r.cover_path,
         r.service_delivery, r.service_pickup, r.delivery_fee, r.delivery_radius_km,
         r.delivery_fee_method, r.latitude, r.longitude,
         r.minimum_order_value, r.estimated_delivery_min_minutes, r.estimated_delivery_max_minutes,
         r.payment_pix, r.payment_cash, r.payment_card
  from public.restaurants r
  where r.slug = p_slug
    and r.onboarding_completed = true;
$function$;

revoke all on function public.get_public_restaurant_by_slug(text) from public;
grant execute on function public.get_public_restaurant_by_slug(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- get_public_order — adiciona delivery_distance_km (mostrado no
-- acompanhamento do pedido, mesma tela que já mostra taxa/endereço).
-- ---------------------------------------------------------------------------
drop function public.get_public_order(text, uuid);

create function public.get_public_order(p_slug text, p_public_id uuid)
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
  delivery_distance_km numeric,
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
stable security definer
set search_path to 'public'
as $function$
  select
    o.public_id, o.order_number, o.status, o.fulfillment_type, o.payment_method, o.change_for,
    o.customer_name, o.customer_phone,
    o.delivery_zip, o.delivery_street, o.delivery_number, o.delivery_complement, o.delivery_neighborhood,
    o.delivery_city, o.delivery_state, o.delivery_reference, o.delivery_distance_km,
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
$function$;

revoke all on function public.get_public_order(text, uuid) from public;
grant execute on function public.get_public_order(text, uuid) to anon, authenticated;

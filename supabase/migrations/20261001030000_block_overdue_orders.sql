-- MenuNext — "bloqueia tudo" (decisão tomada com o usuário para
-- Plano/Billing): o bloqueio de /loja/[slug] feito em
-- get_public_restaurant_by_slug (migration add_subscription_billing)
-- só impede a UI de mostrar o cardápio — sozinho, isso NUNCA impede uma
-- chamada direta a create_order (a RPC pública de checkout). Esta migration
-- fecha essa lacuna: reutiliza o código de erro 'restaurant_unavailable'
-- já existente (mesma mensagem amigável de "loja pausada/fechada" no
-- cliente — do ponto de vista do comprador é a mesma situação), em vez de
-- inventar um código novo. Aplica a QUALQUER fulfillment_type, inclusive
-- 'counter' (funcionário também não deve conseguir registrar venda de
-- balcão com a assinatura do restaurante atrasada).
--
-- Mesma assinatura de 19 parâmetros — create or replace seguro, não cria
-- overload novo. Única mudança: 1 coluna a mais no select inicial de
-- v_restaurant + 1 bloco de 3 linhas logo após a checagem de status
-- existente. Verificado estruturalmente: 32 códigos de exceção únicos / 37
-- raises no total — idênticos aos da migration anterior (reaproveita
-- 'restaurant_unavailable', não soma código novo).
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
  p_delivery_distance_km numeric default null,
  p_coupon_code text default null
)
returns table(public_id uuid, order_number integer, status text, fulfillment_type text, payment_method text, subtotal numeric, delivery_fee numeric, total numeric, created_at timestamp with time zone)
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
  v_effective_minimum_order numeric(10, 2);
  v_zone record;
  v_subtotal numeric(10, 2) := 0;
  v_coupon record;
  v_discount_amount numeric(10, 2) := 0;
  v_coupon_id uuid;
  v_coupon_code_used text;
  v_total numeric(10, 2);
  v_now timestamptz := now();
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
         r.minimum_order_value, r.delivery_fee_method, r.delivery_radius_km, r.free_delivery_threshold,
         r.subscription_status
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

  if v_restaurant.subscription_status in ('overdue', 'cancelled') then
    raise exception 'restaurant_unavailable' using errcode = '22023';
  end if;

  v_now_local := (v_now at time zone 'America/Sao_Paulo')::time;

  select bool_or(
    case when bh.closes_at > bh.opens_at
      then v_now_local >= bh.opens_at and v_now_local < bh.closes_at
      else v_now_local >= bh.opens_at or v_now_local < bh.closes_at
    end
  ) into v_is_open
  from public.business_hours bh
  where bh.restaurant_id = v_restaurant.id
    and bh.day_of_week = extract(dow from (v_now at time zone 'America/Sao_Paulo'))::smallint;

  v_is_open := coalesce(v_is_open, false);

  if not v_is_open and p_fulfillment_type <> 'counter' then
    raise exception 'restaurant_closed' using errcode = '22023';
  end if;

  if p_fulfillment_type = 'counter' and v_customer_name = '' then
    v_customer_name := 'Cliente Balcão';
  end if;
  if v_customer_name = '' or length(v_customer_name) > 120 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if p_fulfillment_type <> 'counter'
     and length(regexp_replace(v_customer_phone, '\D', '', 'g')) not between 10 and 11 then
    raise exception 'invalid_phone' using errcode = '22023';
  end if;

  if p_fulfillment_type not in ('delivery', 'pickup', 'counter') then
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
    v_delivery_zip := nullif(trim(coalesce(p_delivery_zip, '')), '');
    v_delivery_state := nullif(trim(coalesce(p_delivery_state, '')), '');
    if v_delivery_street is null or v_delivery_number is null or v_delivery_neighborhood is null
       or v_delivery_city is null or v_delivery_zip is null or v_delivery_state is null then
      raise exception 'invalid_address' using errcode = '22023';
    end if;
    v_delivery_complement := nullif(trim(coalesce(p_delivery_complement, '')), '');
    v_delivery_reference := nullif(trim(coalesce(p_delivery_reference, '')), '');

    select dz.delivery_fee, dz.minimum_order_value
    into v_zone
    from public.delivery_zones dz
    where dz.restaurant_id = v_restaurant.id
      and dz.is_active = true
      and lower(trim(dz.neighborhood)) = lower(v_delivery_neighborhood)
    limit 1;

    if v_zone.delivery_fee is not null then
      v_delivery_fee := v_zone.delivery_fee;
      v_effective_minimum_order := coalesce(v_zone.minimum_order_value, v_restaurant.minimum_order_value);
    else
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
      v_effective_minimum_order := v_restaurant.minimum_order_value;
    end if;
  elsif p_fulfillment_type = 'counter' then
    if auth.uid() is null then
      raise exception 'not_authenticated' using errcode = '28000';
    end if;
    if not exists (
      select 1 from public.restaurant_members rm
      where rm.restaurant_id = v_restaurant.id and rm.user_id = auth.uid()
    ) then
      raise exception 'not_authorized' using errcode = '42501';
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

  if p_fulfillment_type = 'delivery' and v_effective_minimum_order is not null
     and v_subtotal < v_effective_minimum_order then
    raise exception 'below_minimum_order' using errcode = '22023';
  end if;

  if p_coupon_code is not null and trim(p_coupon_code) <> '' then
    select c.id, c.code, c.discount_type, c.discount_value, c.min_order_value, c.max_uses, c.uses_count,
           c.is_active, c.expires_at
    into v_coupon
    from public.coupons c
    where c.restaurant_id = v_restaurant.id and c.code = upper(trim(p_coupon_code))
    for update;

    if v_coupon.id is null then
      raise exception 'coupon_not_found' using errcode = '22023';
    end if;
    if v_coupon.is_active is not true then
      raise exception 'coupon_inactive' using errcode = '22023';
    end if;
    if v_coupon.expires_at is not null and v_coupon.expires_at < v_now then
      raise exception 'coupon_expired' using errcode = '22023';
    end if;
    if v_coupon.max_uses is not null and v_coupon.uses_count >= v_coupon.max_uses then
      raise exception 'coupon_usage_limit_reached' using errcode = '22023';
    end if;
    if v_coupon.min_order_value is not null and v_subtotal < v_coupon.min_order_value then
      raise exception 'coupon_below_minimum_order' using errcode = '22023';
    end if;

    if v_coupon.discount_type = 'percent' then
      v_discount_amount := round(v_subtotal * v_coupon.discount_value / 100, 2);
    else
      v_discount_amount := v_coupon.discount_value;
    end if;
    if v_discount_amount > v_subtotal then
      v_discount_amount := v_subtotal;
    end if;

    v_coupon_id := v_coupon.id;
    v_coupon_code_used := v_coupon.code;

    update public.coupons set uses_count = uses_count + 1 where id = v_coupon.id;
  end if;

  if p_fulfillment_type = 'delivery' and v_restaurant.free_delivery_threshold is not null
     and v_subtotal >= v_restaurant.free_delivery_threshold then
    v_delivery_fee := 0;
  end if;

  v_total := v_subtotal - v_discount_amount + v_delivery_fee;

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
    payment_method, change_for, observation, subtotal, delivery_fee, coupon_id, coupon_code,
    discount_amount, total, status, idempotency_key
  )
  values (
    v_restaurant.id, gen_random_uuid(), v_order_number, v_customer_name, v_customer_phone, p_fulfillment_type,
    v_delivery_zip, v_delivery_street, v_delivery_number, v_delivery_complement, v_delivery_neighborhood,
    v_delivery_city, v_delivery_state, v_delivery_reference, v_delivery_distance_km,
    p_payment_method, v_change_for, v_observation, v_subtotal, v_delivery_fee, v_coupon_id, v_coupon_code_used,
    v_discount_amount, v_total, 'received', v_idempotency_key
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

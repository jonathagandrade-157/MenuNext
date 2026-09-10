-- MenuNext — Fase 3.3 (correção): bug real encontrado durante a validação
-- LIVE de create_order (add_public_checkout_and_orders.sql).
--
-- `insert into public.orders (...) ... returning id, public_id` falhava
-- sempre, para QUALQUER chamada que efetivamente criasse um pedido (a
-- chamada nunca chegava a inserir itens/adicionais nem devolver o
-- public_id — só os testes de rejeição, que erram antes desse ponto,
-- passavam). Causa: `create_order` é declarada `returns table (public_id
-- uuid, ...)` — isso faz o PL/pgSQL declarar implicitamente uma VARIÁVEL
-- de saída chamada `public_id` dentro do corpo da função. O `RETURNING
-- public_id` bruto, sem qualificar, ficou ambíguo entre essa variável
-- implícita e a coluna `orders.public_id` sendo retornada pelo INSERT —
-- confirmado ao vivo: `ERROR: 42702: column reference "public_id" is
-- ambiguous / DETAIL: It could refer to either a PL/pgSQL variable or a
-- table column.`
--
-- Correção: mesmo padrão de fix_public_read_restaurant_visibility_check.sql
-- (Fase 3.1) — um `create or replace function` aditivo, mantendo a
-- assinatura idêntica. Adiciona um alias (`insert into ... as o`) e
-- qualifica o RETURNING (`o.id, o.public_id`), desfazendo a ambiguidade.
-- Nenhuma outra mudança de comportamento/segurança.

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
    v_delivery_fee := coalesce(v_restaurant.delivery_fee, 0);
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
    delivery_city, delivery_state, delivery_reference,
    payment_method, change_for, observation, subtotal, delivery_fee, total, status, idempotency_key
  )
  values (
    v_restaurant.id, gen_random_uuid(), v_order_number, v_customer_name, v_customer_phone, p_fulfillment_type,
    v_delivery_zip, v_delivery_street, v_delivery_number, v_delivery_complement, v_delivery_neighborhood,
    v_delivery_city, v_delivery_state, v_delivery_reference,
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
$$;

revoke all on function public.create_order(
  text, text, text, text, text, jsonb, text, text, text, text, text, text, text, text, text, numeric, text
) from public;
grant execute on function public.create_order(
  text, text, text, text, text, jsonb, text, text, text, text, text, text, text, text, text, numeric, text
) to anon, authenticated;

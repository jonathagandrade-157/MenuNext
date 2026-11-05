-- MenuNext — checkout público: passo 1 de 2 (ADITIVO; seguro aplicar antes ou depois do app novo).
--
-- 1) create_counter_order: porta de entrada da venda de balcão (PDV) para membros logados. Hoje o PDV chama
--    create_order direto; no passo 2 create_order deixa de ser chamável por visitantes e usuários logados e o
--    checkout público passa a chamá-la pelo servidor. A venda de balcão precisa continuar valendo com a sessão do
--    próprio membro (create_order confere auth.uid() e o vínculo com a loja), por isso ganha este invólucro.
--    Nenhuma regra muda: ele só repassa para create_order com fulfillment_type = 'counter'.
--
-- 2) Retaguarda no banco para pedidos online: um gatilho barra rajadas (por loja e por telefone) independentemente
--    de quem chamou e mesmo que o contador do app esteja fora do ar (o contador do app falha aberto de propósito).
--    Vendas de balcão (counter) não entram na conta.
--
-- Nada existente é alterado nem removido.

create index if not exists orders_restaurant_created_idx on public.orders (restaurant_id, created_at desc);

create or replace function public.create_counter_order(
  p_slug text,
  p_customer_name text,
  p_customer_phone text,
  p_payment_method text,
  p_items jsonb,
  p_idempotency_key text,
  p_change_for numeric default null,
  p_observation text default null,
  p_coupon_code text default null
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
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  return query
    select c.public_id, c.order_number, c.status, c.fulfillment_type, c.payment_method,
           c.subtotal, c.delivery_fee, c.total, c.created_at
    from public.create_order(
      p_slug, p_customer_name, p_customer_phone, 'counter', p_payment_method, p_items, p_idempotency_key,
      null, null, null, null, null, null, null, null,
      p_change_for, p_observation, null, p_coupon_code
    ) c;
end;
$$;

revoke all on function public.create_counter_order(text, text, text, text, jsonb, text, numeric, text, text) from public, anon;
grant execute on function public.create_counter_order(text, text, text, text, jsonb, text, numeric, text, text) to authenticated;

comment on function public.create_counter_order(text, text, text, text, jsonb, text, numeric, text, text) is
  'Venda de balcão (PDV): só membro logado da loja; repassa para create_order(counter), que valida sessão e vínculo.';

-- Retaguarda: no máximo 300 pedidos online por loja e 15 por telefone numa janela de 10 minutos (valores provisórios).
create or replace function public.guard_online_order_flood()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_since timestamptz := now() - interval '10 minutes';
  v_total integer;
  v_phone integer;
  v_digits text;
begin
  if new.fulfillment_type = 'counter' then
    return new;
  end if;

  select count(*) into v_total
  from public.orders o
  where o.restaurant_id = new.restaurant_id and o.fulfillment_type <> 'counter' and o.created_at >= v_since;
  if v_total >= 300 then
    raise exception 'order_rate_limited' using errcode = '54000';
  end if;

  v_digits := regexp_replace(coalesce(new.customer_phone, ''), '\D', '', 'g');
  if length(v_digits) >= 10 then
    select count(*) into v_phone
    from public.orders o
    where o.restaurant_id = new.restaurant_id and o.fulfillment_type <> 'counter' and o.created_at >= v_since
      and regexp_replace(coalesce(o.customer_phone, ''), '\D', '', 'g') = v_digits;
    if v_phone >= 15 then
      raise exception 'order_rate_limited' using errcode = '54000';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_online_order_flood() from public, anon, authenticated;

drop trigger if exists orders_a_flood_guard on public.orders;
create trigger orders_a_flood_guard
  before insert on public.orders
  for each row execute function public.guard_online_order_flood();

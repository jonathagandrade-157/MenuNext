-- MenuNext — estoque integrado aos pedidos: baixa na venda e estorno no cancelamento. DESLIGADO por padrão.
--
-- Depende de 20261105000000_stock_ledger.sql. ADITIVA: não altera create_order, cancel_order nem as tabelas de
-- pedidos; só acrescenta DOIS gatilhos de leitura/escrita no estoque:
--   * order_items AFTER INSERT  -> baixa o item (create_order insere os itens depois do pedido, linha a linha);
--   * orders AFTER UPDATE OF status -> ao virar 'cancelled', estorna o que foi baixado.
-- Cada gatilho só age se a loja LIGOU a baixa automática (stock_settings.auto_deduct, padrão false, só o OWNER liga)
-- e se o produto tem controle de estoque. Sem isso, retorna na primeira consulta e nada muda.
--
-- GARANTIAS
--   * Baixa duplicada impossível: índice único (order_item_id, kind) em stock_movements + trava da linha do saldo.
--     Repetir a baixa/estorno do mesmo item é um no-op (idempotente), inclusive com chamadas simultâneas.
--   * Estorno só do que foi de fato baixado (inclusive quando a baixa foi limitada ao saldo), no máximo uma vez.
--   * O saldo nunca fica negativo: venda acima do saldo baixa só até zero e a movimentação registra a nota
--     "venda acima do saldo". Estoque é controle interno e NUNCA bloqueia um pedido.
--   * Falha no estoque NUNCA derruba o pedido: o gatilho captura o erro e emite WARNING.
--   * Itens cujo produto foi apagado (product_id nulo) são ignorados.
-- Nunca aplicada em produção por este repositório; validada em PostgreSQL sintético (supabase/tests/stock_orders.sql).

create table public.stock_settings (
  restaurant_id uuid primary key references public.restaurants (id) on delete cascade,
  auto_deduct boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.stock_settings enable row level security;
revoke all on public.stock_settings from public, anon, authenticated;
grant select on public.stock_settings to authenticated;

create policy stock_settings_select_members on public.stock_settings
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

create trigger set_updated_at before update on public.stock_settings
  for each row execute function public.set_updated_at();

alter table public.stock_movements
  add column order_item_id uuid references public.order_items (id) on delete set null;

alter table public.stock_movements drop constraint stock_movements_kind_check;
alter table public.stock_movements
  add constraint stock_movements_kind_check
  check (kind in ('entry', 'exit', 'loss', 'adjustment', 'sale', 'sale_reversal'));

-- No máximo uma baixa e um estorno por item de pedido.
create unique index stock_movements_order_item_kind_idx
  on public.stock_movements (order_item_id, kind)
  where order_item_id is not null;

create or replace function public.stock_set_auto_deduct(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_restaurant uuid;
begin
  select rm.restaurant_id into v_restaurant
    from public.restaurant_members rm
   where rm.user_id = auth.uid() and rm.role = 'OWNER'
   limit 1;
  if v_restaurant is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  insert into public.stock_settings (restaurant_id, auto_deduct)
  values (v_restaurant, p_enabled)
  on conflict (restaurant_id) do update set auto_deduct = excluded.auto_deduct;
  return p_enabled;
end;
$$;

-- Baixa UM item de pedido (idempotente). Interna: só os gatilhos e o dono do banco chamam.
create or replace function public._stock_consume_item(p_item uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_item record;
  v_current integer;
  v_take integer;
  v_new integer;
  v_note text;
  v_rows integer;
begin
  select oi.id, oi.restaurant_id, oi.product_id, oi.quantity, o.status
    into v_item
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
   where oi.id = p_item;
  if not found or v_item.product_id is null or v_item.status = 'cancelled' then
    return false;
  end if;
  if not exists (select 1 from public.stock_settings where restaurant_id = v_item.restaurant_id and auto_deduct) then
    return false;
  end if;

  select quantity into v_current from public.stock_items
   where product_id = v_item.product_id and restaurant_id = v_item.restaurant_id
   for update;
  if not found then
    return false; -- produto sem controle de estoque
  end if;

  v_take := least(v_current, v_item.quantity);
  if v_take <= 0 then
    return false; -- sem saldo: nada a baixar (e nada a estornar depois)
  end if;
  v_new := v_current - v_take;
  v_note := case when v_take < v_item.quantity then 'venda acima do saldo' else null end;

  insert into public.stock_movements (restaurant_id, product_id, kind, delta, balance_after, note, order_item_id)
  values (v_item.restaurant_id, v_item.product_id, 'sale', -v_take, v_new, v_note, p_item)
  on conflict (order_item_id, kind) where order_item_id is not null do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return false; -- já baixado
  end if;

  update public.stock_items set quantity = v_new where product_id = v_item.product_id;
  return true;
end;
$$;

-- Estorna UM item (idempotente): devolve exatamente o que a baixa tirou, no máximo uma vez.
create or replace function public._stock_restore_item(p_item uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sale record;
  v_current integer;
  v_new integer;
  v_rows integer;
begin
  select m.restaurant_id, m.product_id, -m.delta as qty
    into v_sale
    from public.stock_movements m
   where m.order_item_id = p_item and m.kind = 'sale';
  if not found then
    return false;
  end if;

  select quantity into v_current from public.stock_items where product_id = v_sale.product_id for update;
  if not found then
    return false;
  end if;
  v_new := least(v_current + v_sale.qty, 100000000);
  if v_new = v_current then
    return false; -- nada a devolver (a coluna delta não aceita 0)
  end if;

  insert into public.stock_movements (restaurant_id, product_id, kind, delta, balance_after, note, order_item_id)
  values (v_sale.restaurant_id, v_sale.product_id, 'sale_reversal', v_new - v_current, v_new, 'estorno de pedido cancelado', p_item)
  on conflict (order_item_id, kind) where order_item_id is not null do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return false;
  end if;

  update public.stock_items set quantity = v_new where product_id = v_sale.product_id;
  return true;
end;
$$;

create or replace function public._stock_trg_order_item()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  begin
    perform public._stock_consume_item(new.id);
  exception when others then
    raise warning 'stock_consume_failed: %', sqlerrm; -- o estoque nunca bloqueia o pedido
  end;
  return null;
end;
$$;

create or replace function public._stock_trg_order_cancel()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_item uuid;
begin
  begin
    for v_item in select id from public.order_items where order_id = new.id loop
      perform public._stock_restore_item(v_item);
    end loop;
  exception when others then
    raise warning 'stock_restore_failed: %', sqlerrm;
  end;
  return null;
end;
$$;

create trigger stock_consume_after_item_insert
  after insert on public.order_items
  for each row execute function public._stock_trg_order_item();

create trigger stock_restore_after_cancel
  after update of status on public.orders
  for each row
  when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
  execute function public._stock_trg_order_cancel();

revoke all on function public._stock_consume_item(uuid) from public, anon, authenticated;
revoke all on function public._stock_restore_item(uuid) from public, anon, authenticated;
revoke all on function public._stock_trg_order_item() from public, anon, authenticated;
revoke all on function public._stock_trg_order_cancel() from public, anon, authenticated;
revoke all on function public.stock_set_auto_deduct(boolean) from public, anon;
grant execute on function public.stock_set_auto_deduct(boolean) to authenticated;

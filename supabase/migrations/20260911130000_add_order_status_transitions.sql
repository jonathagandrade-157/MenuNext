-- MenuNext — Fase 3.4: operação real de pedidos (Kanban + transição de
-- status server-side + histórico + realtime).
--
-- Inspeção prévia: orders.status (Fase 3.3) já é a máquina de estados
-- canônica — CHECK constraint distingue os status válidos por
-- fulfillment_type. Nenhuma policy de UPDATE existe em orders para
-- authenticated/anon (só a RPC create_order, dona postgres, escreve nela).
-- Esta migration mantém exatamente esse padrão: a única forma de avançar
-- o status é a nova RPC advance_order_status, também SECURITY DEFINER.
--
-- Reaproveita:
-- - is_restaurant_member() para autorizar o lojista (mesmo padrão de toda
--   RPC de escrita do painel).
-- - `select ... for update` para serializar dois operadores tentando
--   avançar o MESMO pedido ao mesmo tempo (trava de linha do Postgres —
--   a segunda chamada só prossegue depois que a primeira commitou, e aí
--   lê o status JÁ atualizado, calculando o próximo passo correto em vez
--   de duplicar a transição).
-- - Publication supabase_realtime (vazia até agora) para o Kanban ouvir
--   INSERT/UPDATE em `orders` via postgres_changes — a mesma policy
--   "orders_select_members" que já protege leitura via REST também é o
--   que o Realtime usa para autorizar a entrega de eventos por linha, então
--   um restaurante nunca recebe evento de outro (não é preciso nenhuma
--   policy nova para isso).

-- ============================================================
-- 1. Timestamps operacionais (úteis para métricas futuras: tempo de
--    preparo, tempo de entrega etc. — só as colunas, sem cálculo agora).
-- ============================================================
alter table public.orders
  add column confirmed_at timestamptz,
  add column preparing_at timestamptz,
  add column ready_at timestamptz,
  add column out_for_delivery_at timestamptz,
  add column delivered_at timestamptz,
  add column picked_up_at timestamptz;

-- ============================================================
-- 2. order_status_history — auditoria/rastreabilidade de cada transição.
--    Sem policy de INSERT: só a RPC (dona postgres) escreve aqui.
-- ============================================================
create table public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  from_status text not null,
  to_status text not null,
  changed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index order_status_history_order_id_idx on public.order_status_history (order_id);
create index order_status_history_restaurant_id_idx on public.order_status_history (restaurant_id);

alter table public.order_status_history enable row level security;

create policy "order_status_history_select_members" on public.order_status_history
  for select to authenticated using (public.is_restaurant_member(restaurant_id));

-- ============================================================
-- 3. advance_order_status — única forma de mudar orders.status.
--
--    Sempre avança UM passo (nunca aceita um status alvo do cliente): o
--    próximo status é calculado no servidor a partir do status ATUAL (lido
--    com `for update`, travando a linha) e do fulfillment_type do pedido.
--    Isso por si só bloqueia qualquer salto inválido (ex.: received ->
--    delivered) — não existe caminho para pular etapas, só para andar uma
--    de cada vez. Pedido em estado terminal (delivered/picked_up/cancelled)
--    ou sem next válido -> 'invalid_transition'.
-- ============================================================
create or replace function public.advance_order_status(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order public.orders;
  v_next text;
  v_now timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;

  if v_order.id is null then
    raise exception 'order_not_found' using errcode = '22023';
  end if;

  if not public.is_restaurant_member(v_order.restaurant_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if v_order.fulfillment_type = 'delivery' then
    v_next := case v_order.status
      when 'received' then 'confirmed'
      when 'confirmed' then 'preparing'
      when 'preparing' then 'ready'
      when 'ready' then 'out_for_delivery'
      when 'out_for_delivery' then 'delivered'
      else null
    end;
  else
    v_next := case v_order.status
      when 'received' then 'confirmed'
      when 'confirmed' then 'preparing'
      when 'preparing' then 'ready'
      when 'ready' then 'picked_up'
      else null
    end;
  end if;

  if v_next is null then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;

  insert into public.order_status_history (restaurant_id, order_id, from_status, to_status, changed_by)
  values (v_order.restaurant_id, v_order.id, v_order.status, v_next, auth.uid());

  update public.orders set
    status = v_next,
    confirmed_at = case when v_next = 'confirmed' then v_now else confirmed_at end,
    preparing_at = case when v_next = 'preparing' then v_now else preparing_at end,
    ready_at = case when v_next = 'ready' then v_now else ready_at end,
    out_for_delivery_at = case when v_next = 'out_for_delivery' then v_now else out_for_delivery_at end,
    delivered_at = case when v_next = 'delivered' then v_now else delivered_at end,
    picked_up_at = case when v_next = 'picked_up' then v_now else picked_up_at end
  where id = v_order.id
  returning * into v_order;

  return v_order;
end;
$$;

revoke all on function public.advance_order_status(uuid) from public, anon;
grant execute on function public.advance_order_status(uuid) to authenticated;

-- ============================================================
-- 4. Realtime — Kanban do lojista escuta INSERT/UPDATE em `orders` via
--    postgres_changes. A policy "orders_select_members" (Fase 3.3) já
--    garante que cada conexão só recebe eventos das linhas que a RLS
--    deixaria ela ler via SELECT — ou seja, só pedidos do próprio
--    restaurant_id. Nenhuma policy nova necessária para isolar tenants no
--    realtime.
--
--    O tracking público (cliente guest) NÃO usa postgres_changes (daria
--    acesso teria que ser via policy de SELECT para anon em `orders`, o
--    que reabriria a listagem proibida no item 19 do prompt). Em vez
--    disso, o Kanban envia um broadcast (`supabase.channel('order:' ||
--    public_id).send(...)`) logo após uma transição bem-sucedida — canal
--    não-privado, sem necessidade de policy: o nome do canal (o próprio
--    public_id, um UUID não adivinhável) já é a mesma "senha" que
--    get_public_order usa como controle de acesso, então não é um limite
--    de segurança novo, só o mesmo estendido ao realtime.
alter publication supabase_realtime add table public.orders;

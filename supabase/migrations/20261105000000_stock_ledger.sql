-- MenuNext — estoque: saldo por produto + livro de movimentações (entrada, saída, perda, ajuste).
--
-- ADITIVA: só cria tabelas e funções novas; não altera create_order, produtos, pedidos nem políticas existentes.
-- O estoque é CONTROLE INTERNO do lojista: NÃO baixa sozinho com as vendas e NÃO bloqueia pedidos (decisão de escopo;
-- baixa automática exigiria mexer no checkout e fica para uma etapa própria).
--
--   * stock_items     — 1 linha por produto controlado: saldo e limite de alerta (estoque baixo).
--   * stock_movements — livro append-only: cada mudança de saldo, com quem fez, quando e o saldo resultante.
--   * Leitura: qualquer membro da loja (STAFF vê o alerta). Escrita: nunca direta — só stock_record_movement e
--     stock_set_threshold (SECURITY DEFINER, exigem OWNER da loja do produto).
--
-- Nunca aplicada em produção por este repositório; validada em PostgreSQL 17 sintético (supabase/tests/stock_ledger.sql).

create table public.stock_items (
  product_id uuid primary key references public.products (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  quantity integer not null default 0 check (quantity >= 0 and quantity <= 100000000),
  low_threshold integer not null default 0 check (low_threshold >= 0 and low_threshold <= 1000000),
  updated_at timestamptz not null default now()
);

create index stock_items_restaurant_idx on public.stock_items (restaurant_id);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  kind text not null check (kind in ('entry', 'exit', 'loss', 'adjustment')),
  -- variação assinada: entrada > 0, saída/perda < 0, ajuste pode ser qualquer sinal (nunca 0)
  delta integer not null check (delta <> 0),
  balance_after integer not null check (balance_after >= 0),
  note text check (note is null or length(note) <= 200),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index stock_movements_product_idx on public.stock_movements (product_id, created_at desc);
create index stock_movements_restaurant_idx on public.stock_movements (restaurant_id, created_at desc);

alter table public.stock_items enable row level security;
alter table public.stock_movements enable row level security;

revoke all on public.stock_items from public, anon, authenticated;
revoke all on public.stock_movements from public, anon, authenticated;
grant select on public.stock_items to authenticated;
grant select on public.stock_movements to authenticated;

create policy stock_items_select_members on public.stock_items
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

create policy stock_movements_select_members on public.stock_movements
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

create trigger set_updated_at before update on public.stock_items
  for each row execute function public.set_updated_at();

-- Registra uma movimentação e atualiza o saldo na mesma transação (linha do saldo travada contra corrida).
--   entry/exit/loss: p_quantity é a quantidade (> 0). adjustment: p_quantity é o NOVO saldo contado (>= 0).
create or replace function public.stock_record_movement(
  p_product_id uuid,
  p_kind text,
  p_quantity integer,
  p_note text default null
)
returns public.stock_items
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_restaurant uuid;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_current integer;
  v_delta integer;
  v_new integer;
  v_item public.stock_items;
begin
  select restaurant_id into v_restaurant from public.products where id = p_product_id;
  if v_restaurant is null or not public.is_restaurant_owner(v_restaurant) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_kind is null or p_kind not in ('entry', 'exit', 'loss', 'adjustment') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity < 0 or p_quantity > 1000000
     or (p_kind <> 'adjustment' and p_quantity = 0) then
    raise exception 'invalid_quantity' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 200 then
    raise exception 'note_too_long' using errcode = '22023';
  end if;

  insert into public.stock_items (product_id, restaurant_id)
  values (p_product_id, v_restaurant)
  on conflict (product_id) do nothing;

  select quantity into v_current from public.stock_items where product_id = p_product_id for update;

  v_delta := case p_kind
    when 'entry' then p_quantity
    when 'adjustment' then p_quantity - v_current
    else -p_quantity
  end;
  v_new := v_current + v_delta;

  if v_new < 0 then
    raise exception 'insufficient_stock' using errcode = '22023';
  end if;
  if v_new > 100000000 then
    raise exception 'quantity_too_large' using errcode = '22023';
  end if;
  if v_delta = 0 then
    raise exception 'no_change' using errcode = '22023';
  end if;

  update public.stock_items set quantity = v_new where product_id = p_product_id returning * into v_item;

  insert into public.stock_movements (restaurant_id, product_id, kind, delta, balance_after, note, created_by)
  values (v_restaurant, p_product_id, p_kind, v_delta, v_new, v_note, auth.uid());

  return v_item;
end;
$function$;

-- Define o limite do alerta de estoque baixo (0 desliga o alerta de "baixo"; "sem estoque" continua valendo).
create or replace function public.stock_set_threshold(p_product_id uuid, p_threshold integer)
returns public.stock_items
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_restaurant uuid;
  v_item public.stock_items;
begin
  select restaurant_id into v_restaurant from public.products where id = p_product_id;
  if v_restaurant is null or not public.is_restaurant_owner(v_restaurant) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_threshold is null or p_threshold < 0 or p_threshold > 1000000 then
    raise exception 'invalid_threshold' using errcode = '22023';
  end if;

  insert into public.stock_items (product_id, restaurant_id, low_threshold)
  values (p_product_id, v_restaurant, p_threshold)
  on conflict (product_id) do update set low_threshold = excluded.low_threshold
  returning * into v_item;

  return v_item;
end;
$function$;

revoke all on function public.stock_record_movement(uuid, text, integer, text) from public, anon;
revoke all on function public.stock_set_threshold(uuid, integer) from public, anon;
grant execute on function public.stock_record_movement(uuid, text, integer, text) to authenticated;
grant execute on function public.stock_set_threshold(uuid, integer) to authenticated;

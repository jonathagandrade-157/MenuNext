-- MenuNext — movimentações do caixa: suprimento (dinheiro colocado no caixa) e sangria (dinheiro retirado).
--
-- Estende a migration de sessões de caixa (20261024020000) de forma ADITIVA:
--   * tabela nova cash_movements (sem privilégio para anon/authenticated; só funções SECURITY DEFINER);
--   * cash_record_movement / cash_movements_list novas;
--   * cash_current e cash_close são redefinidas SEM mudar assinatura nem retorno: o dinheiro esperado passa a ser
--     abertura + vendas em dinheiro + suprimentos - sangrias. Sem movimentações o resultado é idêntico ao anterior
--     (a suíte cash_sessions.sql continua passando como regressão).
--
-- REGRAS
--   * Qualquer membro da loja registra (a equipe opera o caixa); cada linha guarda quem fez e quando. Só o OWNER
--     consulta movimentações de sessões já fechadas.
--   * Só com o caixa aberto. A sessão é travada (FOR UPDATE) para serializar movimentações simultâneas e o fechamento.
--   * Sangria não pode passar do dinheiro disponível no caixa naquele momento.
--   * Movimentações não são editáveis nem apagáveis (sem privilégio de UPDATE/DELETE para ninguém).
-- Nunca aplicada em produção por este repositório; validada em PostgreSQL sintético (supabase/tests/cash_movements.sql).

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  session_id uuid not null references public.cash_sessions (id) on delete cascade,
  kind text not null check (kind in ('supply', 'withdrawal')),
  amount numeric(10, 2) not null check (amount > 0),
  reason text not null check (char_length(reason) between 1 and 200),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index cash_movements_session_idx on public.cash_movements (session_id, created_at desc);

alter table public.cash_movements enable row level security;
revoke all on public.cash_movements from public, anon, authenticated;

-- Soma das movimentações de uma sessão. Interna.
create or replace function public._cash_movement_totals(p_session uuid)
returns table (supplies numeric, withdrawals numeric)
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(sum(amount) filter (where kind = 'supply'), 0),
         coalesce(sum(amount) filter (where kind = 'withdrawal'), 0)
    from public.cash_movements
   where session_id = p_session;
$$;

revoke all on function public._cash_movement_totals(uuid) from public, anon, authenticated;

create or replace function public.cash_record_movement(p_kind text, p_amount numeric, p_reason text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_restaurant uuid;
  v_session public.cash_sessions;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_available numeric;
  t record;
  m record;
  v_id uuid;
begin
  select rm.restaurant_id into v_restaurant
    from public.restaurant_members rm
   where rm.user_id = auth.uid()
   limit 1;
  if v_restaurant is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('supply', 'withdrawal') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 99999999.99 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  if char_length(v_reason) < 1 or char_length(v_reason) > 200 then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  select * into v_session
    from public.cash_sessions s
   where s.restaurant_id = v_restaurant and s.closed_at is null
   for update;
  if not found then
    raise exception 'cash_not_open' using errcode = '55000';
  end if;

  if p_kind = 'withdrawal' then
    select * into t from public._cash_totals(v_restaurant, v_session.opened_at, null);
    select * into m from public._cash_movement_totals(v_session.id);
    v_available := v_session.opening_amount + t.cash_sales + m.supplies - m.withdrawals;
    if p_amount > v_available then
      raise exception 'insufficient_cash' using errcode = '22023';
    end if;
  end if;

  insert into public.cash_movements (restaurant_id, session_id, kind, amount, reason, created_by)
  values (v_restaurant, v_session.id, p_kind, p_amount, v_reason, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Lista movimentações: da sessão aberta (qualquer membro) ou de uma sessão específica (só OWNER da loja).
create or replace function public.cash_movements_list(p_session uuid default null)
returns table (
  id uuid,
  session_id uuid,
  kind text,
  amount numeric,
  reason text,
  created_by_name text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select m.id, m.session_id, m.kind, m.amount, m.reason,
         coalesce(nullif(p.name, ''), 'Usuário'), m.created_at
    from public.cash_movements m
    join public.cash_sessions s on s.id = m.session_id
    join public.restaurant_members rm on rm.restaurant_id = s.restaurant_id and rm.user_id = auth.uid()
    left join public.profiles p on p.user_id = m.created_by
   where (p_session is null and s.closed_at is null)
      or (p_session is not null and s.id = p_session and rm.role = 'OWNER')
   order by m.created_at desc, m.id
   limit 200;
$$;

-- cash_current: mesma assinatura; esperado inclui suprimentos e sangrias.
create or replace function public.cash_current()
returns table (
  session_id uuid,
  opened_at timestamptz,
  opened_by_name text,
  opening_amount numeric,
  orders_count bigint,
  total_sales numeric,
  cash_sales numeric,
  pix_sales numeric,
  card_sales numeric,
  expected_cash numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select s.id,
         s.opened_at,
         coalesce(nullif(p.name, ''), 'Usuário'),
         s.opening_amount,
         t.orders_count,
         t.total_sales,
         t.cash_sales,
         t.pix_sales,
         t.card_sales,
         s.opening_amount + t.cash_sales + mv.supplies - mv.withdrawals
    from public.cash_sessions s
    join public.restaurant_members rm on rm.restaurant_id = s.restaurant_id and rm.user_id = auth.uid()
    left join public.profiles p on p.user_id = s.opened_by
    cross join lateral public._cash_totals(s.restaurant_id, s.opened_at, null) t
    cross join lateral public._cash_movement_totals(s.id) mv
   where s.closed_at is null;
$$;

-- cash_close: mesma assinatura; esperado inclui suprimentos e sangrias.
create or replace function public.cash_close(p_counted_cash numeric, p_notes text default null)
returns table (
  opened_at timestamptz,
  closed_at timestamptz,
  opening_amount numeric,
  orders_count bigint,
  total_sales numeric,
  cash_sales numeric,
  pix_sales numeric,
  card_sales numeric,
  expected_cash numeric,
  counted_cash numeric,
  difference numeric
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_restaurant uuid;
  v_session public.cash_sessions;
  v_closed_at timestamptz := clock_timestamp();
  v_notes text := nullif(left(btrim(coalesce(p_notes, '')), 300), '');
  t record;
  mv record;
  v_expected numeric;
begin
  select rm.restaurant_id into v_restaurant
    from public.restaurant_members rm
   where rm.user_id = auth.uid()
   limit 1;
  if v_restaurant is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_counted_cash is null or p_counted_cash < 0 or p_counted_cash > 99999999.99 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;

  select * into v_session
    from public.cash_sessions s
   where s.restaurant_id = v_restaurant and s.closed_at is null
   for update;
  if not found then
    raise exception 'cash_not_open' using errcode = '55000';
  end if;

  select * into t from public._cash_totals(v_restaurant, v_session.opened_at, v_closed_at);
  select * into mv from public._cash_movement_totals(v_session.id);
  v_expected := v_session.opening_amount + t.cash_sales + mv.supplies - mv.withdrawals;

  update public.cash_sessions s
     set closed_at = v_closed_at,
         closed_by = auth.uid(),
         counted_cash = p_counted_cash,
         expected_cash = v_expected,
         notes = v_notes
   where s.id = v_session.id;

  return query
    select v_session.opened_at, v_closed_at, v_session.opening_amount,
           t.orders_count, t.total_sales, t.cash_sales, t.pix_sales, t.card_sales,
           v_expected, p_counted_cash, p_counted_cash - v_expected;
end;
$$;

revoke all on function public.cash_record_movement(text, numeric, text) from public, anon;
revoke all on function public.cash_movements_list(uuid) from public, anon;
grant execute on function public.cash_record_movement(text, numeric, text) to authenticated;
grant execute on function public.cash_movements_list(uuid) to authenticated;

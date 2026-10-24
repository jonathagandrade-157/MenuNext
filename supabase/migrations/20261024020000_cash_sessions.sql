-- MenuNext — sessões de caixa (abrir e fechar o caixa da Frente de Caixa / PDV).
--
-- Mudança aditiva e isolada: uma tabela nova e funções novas. NENHUMA função existente é alterada
-- (create_order e o fluxo de pedidos ficam intactos) e a tabela orders não ganha coluna: os totais de
-- uma sessão são calculados por janela de tempo sobre as vendas de BALCÃO (fulfillment_type = 'counter')
-- não canceladas feitas entre a abertura e o fechamento.
--
-- REGRAS
--   * Uma única sessão aberta por restaurante (índice único parcial).
--   * Abrir, ver a sessão atual e fechar: qualquer membro da loja (a equipe opera o caixa).
--   * Histórico com diferenças de caixa: só o OWNER.
--   * A tabela não tem política nem privilégio para anon/authenticated: só funções SECURITY DEFINER,
--     que derivam a loja do próprio chamador (nunca recebem um restaurant_id de fora).
--   * Dinheiro esperado no caixa = valor de abertura + vendas em dinheiro da janela. No fechamento
--     informa-se o dinheiro contado; a diferença (contado - esperado) fica registrada.

create table public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  opened_by uuid not null,
  opened_at timestamptz not null default now(),
  opening_amount numeric(10, 2) not null check (opening_amount >= 0),
  closed_by uuid,
  closed_at timestamptz,
  counted_cash numeric(10, 2) check (counted_cash >= 0),
  expected_cash numeric(10, 2),
  notes text check (char_length(notes) <= 300),
  check ((closed_at is null) = (closed_by is null)),
  check (closed_at is null or closed_at >= opened_at)
);

create unique index cash_sessions_one_open_idx on public.cash_sessions (restaurant_id) where closed_at is null;
create index cash_sessions_restaurant_idx on public.cash_sessions (restaurant_id, opened_at desc);

alter table public.cash_sessions enable row level security;
revoke all on public.cash_sessions from public, anon, authenticated;

-- Totais das vendas de balcão de uma loja numa janela [p_from, p_to]. Interna: ninguém a chama de fora.
create or replace function public._cash_totals(p_restaurant uuid, p_from timestamptz, p_to timestamptz)
returns table (orders_count bigint, total_sales numeric, cash_sales numeric, pix_sales numeric, card_sales numeric)
language sql
stable
security definer
set search_path to 'public'
as $$
  select count(o.id),
         coalesce(sum(o.total), 0),
         coalesce(sum(o.total) filter (where o.payment_method = 'cash'), 0),
         coalesce(sum(o.total) filter (where o.payment_method = 'pix'), 0),
         coalesce(sum(o.total) filter (where o.payment_method = 'card'), 0)
    from public.orders o
   where o.restaurant_id = p_restaurant
     and o.fulfillment_type = 'counter'
     and o.status <> 'cancelled'
     and o.created_at >= p_from
     and (p_to is null or o.created_at <= p_to);
$$;

revoke all on function public._cash_totals(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- Abre o caixa da loja do chamador. Devolve o id da sessão.
create or replace function public.cash_open(p_opening_amount numeric)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_restaurant uuid;
  v_id uuid;
begin
  select rm.restaurant_id into v_restaurant
    from public.restaurant_members rm
   where rm.user_id = auth.uid()
   limit 1;
  if v_restaurant is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_opening_amount is null or p_opening_amount < 0 or p_opening_amount > 99999999.99 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  if exists (select 1 from public.cash_sessions where restaurant_id = v_restaurant and closed_at is null) then
    raise exception 'cash_already_open' using errcode = '55000';
  end if;

  insert into public.cash_sessions (restaurant_id, opened_by, opening_amount)
  values (v_restaurant, auth.uid(), p_opening_amount)
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'cash_already_open' using errcode = '55000';
end;
$$;

-- Sessão aberta da loja do chamador, com o resumo até agora (nenhuma linha = caixa fechado).
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
         s.opening_amount + t.cash_sales
    from public.cash_sessions s
    join public.restaurant_members rm on rm.restaurant_id = s.restaurant_id and rm.user_id = auth.uid()
    left join public.profiles p on p.user_id = s.opened_by
    cross join lateral public._cash_totals(s.restaurant_id, s.opened_at, null) t
   where s.closed_at is null;
$$;

-- Fecha o caixa: grava o dinheiro contado, o esperado e a diferença, e devolve o resumo final.
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
  v_expected := v_session.opening_amount + t.cash_sales;

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

-- Histórico de sessões (abertas e fechadas) da loja do chamador. Só o OWNER; os demais recebem vazio.
create or replace function public.cash_history(p_limit integer default 20)
returns table (
  session_id uuid,
  opened_at timestamptz,
  closed_at timestamptz,
  opened_by_name text,
  closed_by_name text,
  opening_amount numeric,
  counted_cash numeric,
  expected_cash numeric,
  difference numeric,
  orders_count bigint,
  total_sales numeric,
  notes text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select s.id,
         s.opened_at,
         s.closed_at,
         coalesce(nullif(po.name, ''), 'Usuário'),
         coalesce(nullif(pc.name, ''), case when s.closed_by is null then null else 'Usuário' end),
         s.opening_amount,
         s.counted_cash,
         s.expected_cash,
         s.counted_cash - s.expected_cash,
         t.orders_count,
         t.total_sales,
         s.notes
    from public.cash_sessions s
    join public.restaurant_members rm
      on rm.restaurant_id = s.restaurant_id and rm.user_id = auth.uid() and rm.role = 'OWNER'
    left join public.profiles po on po.user_id = s.opened_by
    left join public.profiles pc on pc.user_id = s.closed_by
    cross join lateral public._cash_totals(s.restaurant_id, s.opened_at, s.closed_at) t
   order by s.opened_at desc
   limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

revoke all on function public.cash_open(numeric) from public, anon;
revoke all on function public.cash_current() from public, anon;
revoke all on function public.cash_close(numeric, text) from public, anon;
revoke all on function public.cash_history(integer) from public, anon;
grant execute on function public.cash_open(numeric) to authenticated;
grant execute on function public.cash_current() to authenticated;
grant execute on function public.cash_close(numeric, text) to authenticated;
grant execute on function public.cash_history(integer) to authenticated;

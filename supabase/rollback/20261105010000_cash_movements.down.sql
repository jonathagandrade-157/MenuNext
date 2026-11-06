-- ROLLBACK (NÃO é migration; nunca rodar em produção sem backup aprovado e decisão do dono).
-- Testado só em PostgreSQL sintético (scripts/checkout-lab/rollback.mjs). Cada arquivo desfaz UMA migration de mesmo nome.
-- Ordem: do mais novo para o mais antigo. Apagar tabelas APAGA OS DADOS que estiverem nelas.

-- Restaura as definições ORIGINAIS de cash_current e cash_close (migration 20261024020000), sem movimentações.
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

drop function if exists public.cash_record_movement(text, numeric, text);
drop function if exists public.cash_movements_list(uuid);
drop function if exists public._cash_movement_totals(uuid);
drop table if exists public.cash_movements;

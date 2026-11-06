-- MenuNext — vendas de uma sessão de caixa (histórico detalhado). SOMENTE LEITURA, aditiva.
--
-- Mesma janela de _cash_totals: vendas de BALCÃO (fulfillment_type = 'counter') feitas entre a abertura e o fechamento
-- da sessão. Devolve também as canceladas (com o status), para o lojista conferir; os totais do app ignoram canceladas.
--   * p_session nulo: sessão ABERTA da loja do chamador (qualquer membro).
--   * p_session informado: só o OWNER da loja dona da sessão (sessões fechadas).
-- Sem privilégio de tabela novo; a função deriva a loja do chamador e nunca recebe restaurant_id de fora.
-- Nunca aplicada em produção por este repositório; validada em PostgreSQL sintético (supabase/tests/cash_session_sales.sql).

create or replace function public.cash_session_sales(p_session uuid default null)
returns table (
  order_id uuid,
  order_number integer,
  created_at timestamptz,
  payment_method text,
  status text,
  total numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select o.id, o.order_number, o.created_at, o.payment_method, o.status, o.total
    from public.cash_sessions s
    join public.restaurant_members rm on rm.restaurant_id = s.restaurant_id and rm.user_id = auth.uid()
    join public.orders o
      on o.restaurant_id = s.restaurant_id
     and o.fulfillment_type = 'counter'
     and o.created_at >= s.opened_at
     and (s.closed_at is null or o.created_at <= s.closed_at)
   where (p_session is null and s.closed_at is null)
      or (p_session is not null and s.id = p_session and rm.role = 'OWNER')
   order by o.created_at desc, o.order_number desc
   limit 500;
$$;

revoke all on function public.cash_session_sales(uuid) from public, anon;
grant execute on function public.cash_session_sales(uuid) to authenticated;

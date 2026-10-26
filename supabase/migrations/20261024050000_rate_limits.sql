-- MenuNext — limite de tentativas (login, cadastro, pedidos da loja pública, cupons).
--
-- Contador por "balde" (ex.: "login:ip:203.0.113.7") em janelas fixas de tempo. Só o BACKEND (service_role)
-- consegue contar: a tabela e a função são fechadas para visitantes e usuários logados — se fossem abertas,
-- qualquer um poderia gastar a cota de outro IP. O app falha ABERTO se o contador estiver fora do ar (um
-- problema aqui nunca deve derrubar a loja); o limite é uma camada extra, não a única defesa.
--
-- Mudança aditiva: uma tabela e uma função novas; nada existente é alterado.

create table public.rate_limits (
  bucket text not null check (char_length(bucket) between 1 and 200),
  window_start timestamptz not null,
  hits integer not null default 0 check (hits >= 0),
  primary key (bucket, window_start)
);

create index rate_limits_window_idx on public.rate_limits (window_start);

alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from public, anon, authenticated;

-- Registra UMA tentativa no balde e diz se ainda está dentro do limite da janela atual.
create or replace function public.rate_limit_hit(p_bucket text, p_limit integer, p_window_seconds integer)
returns table (is_allowed boolean, hit_count integer, retry_after integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_now timestamptz := now();
  v_window timestamptz;
  v_hits integer;
begin
  if p_bucket is null or char_length(p_bucket) not between 1 and 200
     or p_limit is null or p_limit not between 1 and 100000
     or p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    raise exception 'invalid_rate_limit_args' using errcode = '22023';
  end if;

  v_window := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limits as rl (bucket, window_start, hits)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set hits = rl.hits + 1
  returning rl.hits into v_hits;

  -- limpeza: janelas velhas do próprio balde (barato, sempre) e, de vez em quando, de todos
  delete from public.rate_limits rl where rl.bucket = p_bucket and rl.window_start < v_now - interval '1 day';
  if random() < 0.02 then
    delete from public.rate_limits rl where rl.window_start < v_now - interval '1 day';
  end if;

  return query
    select v_hits <= p_limit,
           v_hits,
           greatest(1, ceil(extract(epoch from (v_window + make_interval(secs => p_window_seconds) - v_now)))::integer);
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

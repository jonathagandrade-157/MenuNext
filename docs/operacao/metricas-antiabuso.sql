-- Acompanhamento dos limites antiabuso do checkout SEM registrar dado pessoal novo.
-- SOMENTE LEITURA. Rode 1x por dia (SQL Editor do Supabase ou execute_sql) e guarde só os NÚMEROS (não as linhas brutas).
--
-- O que existe hoje: a tabela rate_limits guarda baldes por janela (hits por balde) e os apaga depois de 1 dia. O IP e o
-- telefone entram nos baldes apenas como HASH (SHA-256 truncado); o nome do balde é "<escopo>:<…>".
-- O que NÃO existe: um registro de cada negação. Estas consultas inferem as negações pelo que passou do limite
-- (tentativas_negadas = hits - limite). Para métricas mais finas, ver "Sprint 2" em S2-ANTIABUSO-METRICAS.md.
--
-- Ajuste a tabela `lim` se os limites forem alterados (ORDER_LIMITS em src/lib/checkoutGuard.ts).

-- 1) Negações por escopo nas últimas 24 h
with lim(scope, lim) as (values
  ('pedido:ip', 30), ('pedido:loja-ip', 15), ('pedido:loja', 120), ('pedido:fone', 8), ('cupom:ip', 20), ('cupom:loja', 120)
), b as (
  select split_part(bucket, ':', 1) || ':' || split_part(bucket, ':', 2) as scope, bucket, window_start, hits
  from public.rate_limits
  where window_start > now() - interval '24 hours'
)
select b.scope,
       count(*)                                         as janelas,
       count(*) filter (where b.hits > l.lim)           as janelas_estouradas,
       coalesce(sum(greatest(b.hits - l.lim, 0)), 0)    as tentativas_negadas,
       max(b.hits)                                      as maior_balde
from b join lim l on l.scope = b.scope
group by b.scope
order by tentativas_negadas desc;

-- 2) Pressão por loja: quanto do teto de 120 / 10 min cada loja chegou a usar (alerta em 60% = 72)
select split_part(bucket, ':', 3) as loja, max(hits) as maior_janela_10min, round(100.0 * max(hits) / 120, 0) as pct_do_teto
from public.rate_limits
where bucket like 'pedido:loja:%' and window_start > now() - interval '24 hours'
group by 1
order by 2 desc;

-- 3) Possíveis FALSOS POSITIVOS por telefone: telefones (só o hash) bloqueados que fecharam pedido na MESMA loja em até 40 min
--    depois do começo da janela. Um número alto em relação aos bloqueios indica limite apertado demais. Não mostra o telefone.
with over as (
  select split_part(bucket, ':', 3) as slug, split_part(bucket, ':', 4) as phone_hash, window_start, hits
  from public.rate_limits
  where bucket like 'pedido:fone:%' and hits > 8 and window_start > now() - interval '24 hours'
)
select o.slug,
       count(*) as telefones_bloqueados,
       count(*) filter (where exists (
         select 1
         from public.orders od join public.restaurants r on r.id = od.restaurant_id
         where r.slug = o.slug
           and left(encode(sha256(convert_to(right(regexp_replace(od.customer_phone, '\D', '', 'g'), 11), 'UTF8')), 'hex'), 32) = o.phone_hash
           and od.created_at > o.window_start + interval '10 minutes'
           and od.created_at <= o.window_start + interval '40 minutes'
       )) as depois_conseguiu_pedir
from over o
group by o.slug
order by telefones_bloqueados desc;

-- 4) Ataque × uso legítimo por IP+loja: se poucos baldes concentram as negações, é ataque (apertar);
--    se as negações estão espalhadas por muitos baldes, é uso legítimo (afrouxar).
select split_part(bucket, ':', 3) as loja,
       count(*) filter (where hits > 15)                  as baldes_estourados,
       count(*)                                           as baldes_ativos,
       coalesce(sum(greatest(hits - 15, 0)), 0)           as tentativas_negadas
from public.rate_limits
where bucket like 'pedido:loja-ip:%' and window_start > now() - interval '24 hours'
group by 1
order by tentativas_negadas desc;

-- 5) Contexto: pedidos online criados por loja nas últimas 24 h (para dividir as negações pelo volume real)
select r.slug, count(*) as pedidos_online_24h
from public.orders o join public.restaurants r on r.id = o.restaurant_id
where o.fulfillment_type <> 'counter' and o.created_at > now() - interval '24 hours'
group by r.slug
order by 2 desc;

-- 6) Retaguarda do banco: pedidos online por loja na MAIOR janela de 10 min (compare com 300) — aproximação por hora cheia
select r.slug, date_trunc('hour', o.created_at) as hora, count(*) as pedidos_na_hora
from public.orders o join public.restaurants r on r.id = o.restaurant_id
where o.fulfillment_type <> 'counter' and o.created_at > now() - interval '24 hours'
group by 1, 2
order by 3 desc
limit 10;

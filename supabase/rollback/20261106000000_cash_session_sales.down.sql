-- ROLLBACK (NÃO é migration; nunca rodar em produção sem backup aprovado e decisão do dono).
-- Testado só em PostgreSQL sintético (scripts/checkout-lab/rollback.mjs). Cada arquivo desfaz UMA migration de mesmo nome.
-- Ordem: do mais novo para o mais antigo. Apagar tabelas APAGA OS DADOS que estiverem nelas.

drop function if exists public.cash_session_sales(uuid);

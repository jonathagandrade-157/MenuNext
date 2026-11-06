-- ROLLBACK (NÃO é migration; nunca rodar em produção sem backup aprovado e decisão do dono).
-- Testado só em PostgreSQL sintético (scripts/checkout-lab/rollback.mjs). Cada arquivo desfaz UMA migration de mesmo nome.
-- Ordem: do mais novo para o mais antigo. Apagar tabelas APAGA OS DADOS que estiverem nelas.

drop function if exists public.support_create_ticket(text, text, text);
drop function if exists public.support_add_message(uuid, text);
drop function if exists public.support_set_status(uuid, text);
drop function if exists public.support_set_priority(uuid, text);
drop function if exists public.support_admin_list(text, integer);
drop table if exists public.support_messages;
drop table if exists public.support_tickets;

-- ROLLBACK (NÃO é migration; nunca rodar em produção sem backup aprovado e decisão do dono).
-- Testado só em PostgreSQL sintético (scripts/checkout-lab/rollback.mjs). Cada arquivo desfaz UMA migration de mesmo nome.
-- Ordem: do mais novo para o mais antigo. Apagar tabelas APAGA OS DADOS que estiverem nelas.

-- Remove os gatilhos primeiro: a partir daqui pedidos novos não mexem mais no estoque.
drop trigger if exists stock_consume_after_item_insert on public.order_items;
drop trigger if exists stock_restore_after_cancel on public.orders;
drop function if exists public._stock_trg_order_item();
drop function if exists public._stock_trg_order_cancel();
drop function if exists public._stock_consume_item(uuid);
drop function if exists public._stock_restore_item(uuid);
drop function if exists public.stock_set_auto_deduct(boolean);
-- Vendas e estornos registrados no livro deixam de ter tipo válido: ficam no saldo, mas as linhas são removidas.
-- (O saldo em stock_items NÃO é recalculado: continua como estava.)
delete from public.stock_movements where kind in ('sale', 'sale_reversal');
drop index if exists public.stock_movements_order_item_kind_idx;
alter table public.stock_movements drop column if exists order_item_id;
alter table public.stock_movements drop constraint if exists stock_movements_kind_check;
alter table public.stock_movements add constraint stock_movements_kind_check check (kind in ('entry', 'exit', 'loss', 'adjustment'));
drop table if exists public.stock_settings;

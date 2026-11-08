-- ROLLBACK (NÃO é migration). Desfaz 20261105040000_product_variants (cadastro de variantes).
-- ORDEM: rode ANTES o rollback de 20261108000000_order_item_variants (que depende desta tabela).
-- ATENÇÃO: apaga as variantes cadastradas. Os pedidos antigos continuam com o nome "Produto — Variante" gravado
-- no item (order_items.product_name); a coluna order_items.variant_id já terá sido removida pelo outro rollback.
drop function if exists public.product_variant_delete(uuid);
drop function if exists public.product_variant_set_available(uuid, boolean);
drop function if exists public.product_variant_update(uuid, text, numeric, boolean);
drop function if exists public.product_variant_create(uuid, text, numeric, boolean);
drop table if exists public.product_variants;

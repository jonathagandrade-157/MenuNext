-- ROLLBACK (NÃO é migration). Desfaz 20261108000000_order_item_variants: devolve create_order ao cálculo só pelo
-- preço do produto e remove a leitura pública e as colunas de variante dos itens (o NOME do item já gravado,
-- "Produto — Variante", permanece nos pedidos antigos). Mesmo método de troca exata, aplicado ao contrário.
do $patch$
declare
  v_oid oid := 'public.create_order(text,text,text,text,text,jsonb,text,text,text,text,text,text,text,text,text,numeric,text,numeric,text)'::regprocedure;
  v_def text := replace(pg_get_functiondef('public.create_order(text,text,text,text,text,jsonb,text,text,text,text,text,text,text,text,text,numeric,text,numeric,text)'::regprocedure), chr(13), '');
  v_a int;
  v_b int;
begin
  -- remove o bloco de validação da variante (entre o comentário e a linha do subtotal)
  v_a := position('    -- Variante: com variante, o preço é o dela (do banco)' in v_def);
  v_b := position('    v_item_subtotal := v_unit_price * v_quantity;' in v_def);
  if v_a = 0 or v_b = 0 then raise exception 'create_order nao tem o bloco de variante; nada foi alterado'; end if;
  v_def := substr(v_def, 1, v_a - 1) || '    v_item_subtotal := v_product.price * v_quantity;' || substr(v_def, v_b + length('    v_item_subtotal := v_unit_price * v_quantity;'));
  -- insert dos itens
  v_a := position('    v_variant_id := null;
    v_variant_name := null;
    v_unit_price := v_product.price;
    if nullif' in v_def);
  v_b := position('v_unit_price * v_quantity, v_variant_id, v_variant_name)' in v_def);
  if v_a = 0 or v_b = 0 then raise exception 'create_order nao tem o insert de variante; nada foi alterado'; end if;
  v_def := substr(v_def, 1, v_a - 1)
    || '    insert into public.order_items (restaurant_id, order_id, product_id, product_name, unit_price, quantity, observation, subtotal)
    values (v_restaurant.id, v_order_id, v_product.id, v_product.name, v_product.price, v_quantity, v_item_observation, v_product.price * v_quantity)'
    || substr(v_def, v_b + length('v_unit_price * v_quantity, v_variant_id, v_variant_name)'));
  -- declarações
  v_def := replace(v_def, '  v_variant_id uuid;
  v_variant_name text;
  v_variant_price numeric;
  v_variant_available boolean;
  v_unit_price numeric;
', '');
  execute v_def;
end
$patch$;

drop policy if exists product_variants_select_public on public.product_variants;
revoke select on public.product_variants from anon;
alter table public.order_items drop column if exists variant_name;
alter table public.order_items drop column if exists variant_id;

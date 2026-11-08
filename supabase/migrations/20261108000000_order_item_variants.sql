-- MenuNext — variantes no PEDIDO (ex.: pizza Pequena/Média/Grande com preço próprio).
--
-- Depende de 20261105040000_product_variants.sql. NUNCA aplicada em produção por este repositório.
--
-- O QUE MUDA
--   1. order_items ganha variant_id e variant_name (o nome do item passa a ser "Produto — Variante", então
--      comanda, KDS, histórico e relatórios mostram a variante sem nenhuma outra mudança).
--   2. A loja pública passa a LER as variantes (mesma regra dos produtos: loja publicamente visível).
--   3. create_order: o item pode trazer "variant_id". Com variante, o preço é o DA VARIANTE (do banco, nunca do
--      navegador); produto que TEM variantes exige a escolha (variant_required); variante de outro produto ou de
--      outra loja não existe (variant_not_found); variante desligada é recusada (variant_unavailable).
--      Produto sem variantes: pedido idêntico ao de antes. Vale para o checkout e para o PDV (os dois passam por
--      create_order; o create_counter_order da migration 20261027010000 só repassa os itens).
--
-- MUDANÇA EM create_order — mesmo método da migration de promoções (20261024030000): NÃO carrega uma cópia da
-- função (o texto versionado nas migrations antigas está defasado em relação à produção). Lê a definição que está
-- no banco e troca 3 trechos, cada um exigido EXATAMENTE uma vez; se algum não bater, aborta sem mudar nada.
-- Mesma assinatura e mesmos privilégios (CREATE OR REPLACE preserva os GRANTs, inclusive os da migration
-- 20261027020000, se ela já tiver sido aplicada).

-- ============================================================
-- 1. order_items: variante gravada no item
-- ============================================================
alter table public.order_items
  add column variant_id uuid references public.product_variants (id) on delete set null,
  add column variant_name text check (variant_name is null or char_length(variant_name) between 1 and 60);

-- ============================================================
-- 2. leitura pública das variantes (como products_select_public)
-- ============================================================
grant select on public.product_variants to anon;

create policy product_variants_select_public on public.product_variants
  for select to anon, authenticated
  using (public.is_restaurant_publicly_visible(restaurant_id));

-- ============================================================
-- 2b. sinal de compatibilidade para o aplicativo: a loja/PDV só mostram variantes quando esta função existe,
--     ou seja, quando create_order já cobra a variante. Sem ela (banco só com 20261105040000, ou depois do
--     rollback), o app esconde as variantes e o pedido segue pelo preço do produto — nunca mostra uma opção
--     que o pedido ignoraria.
-- ============================================================
create or replace function public.order_variants_supported()
returns boolean
language sql
immutable
set search_path to 'public'
as $$ select true $$;

revoke all on function public.order_variants_supported() from public;
grant execute on function public.order_variants_supported() to anon, authenticated;

-- ============================================================
-- 3. create_order
-- ============================================================
do $patch$
declare
  v_oid oid := 'public.create_order(text,text,text,text,text,jsonb,text,text,text,text,text,text,text,text,text,numeric,text,numeric,text)'::regprocedure;
  v_def text;
  v_from text[];
  v_to text[];
  v_n integer;
  v_f text;
  v_t text;
  i integer;
begin
  v_def := replace(pg_get_functiondef(v_oid), chr(13), '');

  v_from := array[
    $f1$  v_product record;
$f1$,
    $f2$    v_item_subtotal := v_product.price * v_quantity;
$f2$,
    $f3$    insert into public.order_items (restaurant_id, order_id, product_id, product_name, unit_price, quantity, observation, subtotal)
    values (v_restaurant.id, v_order_id, v_product.id, v_product.name, v_product.price, v_quantity, v_item_observation, v_product.price * v_quantity)
$f3$
  ];

  v_to := array[
    $t1$  v_product record;
  v_variant_id uuid;
  v_variant_name text;
  v_variant_price numeric;
  v_variant_available boolean;
  v_unit_price numeric;
$t1$,
    $t2$    -- Variante: com variante, o preço é o dela (do banco); produto que tem variantes exige a escolha.
    v_variant_id := null;
    v_variant_name := null;
    v_variant_available := null;
    v_unit_price := v_product.price;
    if nullif(v_item ->> 'variant_id', '') is not null then
      begin
        select pv.id, pv.name, pv.price, pv.is_available
          into v_variant_id, v_variant_name, v_variant_price, v_variant_available
          from public.product_variants pv
         where pv.id = (v_item ->> 'variant_id')::uuid
           and pv.product_id = v_product.id
           and pv.restaurant_id = v_restaurant.id;
      exception when others then
        raise exception 'invalid_items' using errcode = '22023';
      end;
      if v_variant_id is null then
        raise exception 'variant_not_found' using errcode = '22023';
      end if;
      if v_variant_available is not true then
        raise exception 'variant_unavailable' using errcode = '22023';
      end if;
      v_unit_price := v_variant_price;
    elsif exists (select 1 from public.product_variants pv where pv.product_id = v_product.id) then
      raise exception 'variant_required' using errcode = '22023';
    end if;
    v_item_subtotal := v_unit_price * v_quantity;
$t2$,
    $t3$    v_variant_id := null;
    v_variant_name := null;
    v_unit_price := v_product.price;
    if nullif(v_item ->> 'variant_id', '') is not null then
      select pv.id, pv.name, pv.price into v_variant_id, v_variant_name, v_unit_price
        from public.product_variants pv
       where pv.id = (v_item ->> 'variant_id')::uuid and pv.product_id = v_product.id and pv.restaurant_id = v_restaurant.id;
    end if;

    insert into public.order_items (restaurant_id, order_id, product_id, product_name, unit_price, quantity, observation, subtotal, variant_id, variant_name)
    values (v_restaurant.id, v_order_id, v_product.id,
            case when v_variant_name is null then v_product.name else left(v_product.name || ' — ' || v_variant_name, 200) end,
            v_unit_price, v_quantity, v_item_observation, v_unit_price * v_quantity, v_variant_id, v_variant_name)
$t3$
  ];

  for i in 1 .. array_length(v_from, 1) loop
    v_f := replace(v_from[i], chr(13), '');
    v_t := replace(v_to[i], chr(13), '');
    v_n := (length(v_def) - length(replace(v_def, v_f, ''))) / length(v_f);
    if v_n <> 1 then
      raise exception 'create_order mudou: trecho % aparece % vez(es) (esperado 1); nada foi alterado', i, v_n using errcode = '55000';
    end if;
    v_def := replace(v_def, v_f, v_t);
  end loop;

  execute v_def;
end
$patch$;

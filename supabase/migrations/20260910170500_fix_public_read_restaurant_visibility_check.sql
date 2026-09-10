-- MenuNext — Fase 3.1 (correção): a policy pública de categories/products/
-- product_images/combos/combo_items/business_hours criada na migration
-- anterior (add_public_storefront_read_access) usava um EXISTS direto
-- contra `restaurants` para checar `onboarding_completed = true`. Isso não
-- funciona: `restaurants` também tem RLS habilitado, e o papel `anon` não
-- tem NENHUMA policy de SELECT na tabela restaurants (a leitura pública do
-- restaurante em si é feita só pela RPC get_public_restaurant_by_slug).
-- Então aquele EXISTS, avaliado como `anon`, sempre retornava vazio (RLS
-- bloqueando a subquery), e a policy nunca liberava nenhuma linha —
-- confirmado ao vivo: `set local role anon` + select em categories
-- devolvia 0 linhas mesmo para categoria ativa de restaurante publicado.
--
-- Correção: mesmo padrão já usado por is_restaurant_member() — um helper
-- SECURITY DEFINER, que roda com os privilégios do dono da função (bypassa
-- RLS internamente) mas só expõe um boolean, nunca dados da linha. Substitui
-- o EXISTS cru nas 6 policies afetadas.

create or replace function public.is_restaurant_publicly_visible(target_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.restaurants r
    where r.id = target_restaurant_id and r.onboarding_completed = true
  );
$$;

revoke all on function public.is_restaurant_publicly_visible(uuid) from public;
grant execute on function public.is_restaurant_publicly_visible(uuid) to anon, authenticated;

drop policy "categories_select_public" on public.categories;
create policy "categories_select_public" on public.categories
  for select to anon, authenticated
  using (is_active = true and public.is_restaurant_publicly_visible(restaurant_id));

drop policy "products_select_public" on public.products;
create policy "products_select_public" on public.products
  for select to anon, authenticated
  using (public.is_restaurant_publicly_visible(restaurant_id));

drop policy "product_images_select_public" on public.product_images;
create policy "product_images_select_public" on public.product_images
  for select to anon, authenticated
  using (public.is_restaurant_publicly_visible(restaurant_id));

drop policy "combos_select_public" on public.combos;
create policy "combos_select_public" on public.combos
  for select to anon, authenticated
  using (public.is_restaurant_publicly_visible(restaurant_id));

drop policy "combo_items_select_public" on public.combo_items;
create policy "combo_items_select_public" on public.combo_items
  for select to anon, authenticated
  using (public.is_restaurant_publicly_visible(restaurant_id));

drop policy "business_hours_select_public" on public.business_hours;
create policy "business_hours_select_public" on public.business_hours
  for select to anon, authenticated
  using (public.is_restaurant_publicly_visible(restaurant_id));

-- MenuNext — Fase 3.1: Loja pública real (leitura pública mínima e segura).
--
-- Inspeção prévia: TODAS as policies de SELECT em restaurants/categories/
-- products/product_images/combos/combo_items/business_hours hoje exigem
-- is_restaurant_member() — só o dono/staff autenticado enxerga qualquer
-- linha. A loja pública (/loja/[slug]) roda com a anon key (visitante sem
-- login) e, portanto, não conseguia ler NADA — bloqueada por completo pelo
-- RLS. As tabelas já têm GRANT de SELECT para `anon`/`authenticated` no
-- nível do schema (padrão do Supabase); o que faltava era a policy de RLS.
--
-- Este arquivo adiciona o mínimo necessário para a Home pública funcionar,
-- sem NENHUM `using (true)`:
--
-- 1) restaurants: nenhuma policy de tabela nova. RLS é por LINHA, não por
--    coluna, e a tabela tem colunas sensíveis fora do escopo desta fase
--    (payment_pix_key, endereço completo, onboarding_step — pagamento e
--    checkout não são implementados aqui). Por isso a leitura pública do
--    restaurante usa uma RPC SECURITY DEFINER (mesmo padrão já usado no
--    projeto para leituras controladas: is_slug_available,
--    is_document_eligible) que devolve só os campos realmente necessários
--    à Home: nome, slug, status, onboarding_completed, logo/capa,
--    entrega/retirada. Um restaurante que nunca concluiu o onboarding
--    (onboarding_completed = false) continua totalmente invisível ao
--    público — ninguém deve ver a "loja" de um cadastro ainda em rascunho.
-- 2) categories/products/product_images/combos/combo_items/business_hours:
--    novas policies de SELECT para `anon`+`authenticated`, cada uma restrita
--    a linhas cujo restaurante já tem onboarding_completed = true — nunca
--    `true` puro. Isso garante que /loja/restaurante-a jamais devolve
--    linhas de outro restaurante: a condição sempre amarra pelo
--    restaurant_id real da própria linha.
-- 3) categories: além da condição acima, exige is_active = true — só
--    categorias ativas ficam visíveis ao público (produtos/combos mantêm
--    seu próprio tratamento visual de indisponível em vez de serem
--    ocultados, então a policy deles não filtra por disponibilidade).
--
-- Nenhuma policy/RPC existente foi alterada ou removida; tudo aqui é
-- aditivo e somente leitura.

create or replace function public.get_public_restaurant_by_slug(p_slug text)
returns table (
  id uuid,
  name text,
  slug text,
  status text,
  onboarding_completed boolean,
  logo_path text,
  cover_path text,
  service_delivery boolean,
  service_pickup boolean,
  delivery_fee numeric,
  delivery_radius_km numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select r.id, r.name, r.slug, r.status, r.onboarding_completed, r.logo_path, r.cover_path,
         r.service_delivery, r.service_pickup, r.delivery_fee, r.delivery_radius_km
  from public.restaurants r
  where r.slug = p_slug
    and r.onboarding_completed = true;
$$;

revoke all on function public.get_public_restaurant_by_slug(text) from public;
grant execute on function public.get_public_restaurant_by_slug(text) to anon, authenticated;

create policy "categories_select_public" on public.categories
  for select to anon, authenticated
  using (
    is_active = true
    and exists (
      select 1 from public.restaurants r
      where r.id = categories.restaurant_id and r.onboarding_completed = true
    )
  );

create policy "products_select_public" on public.products
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.restaurants r
      where r.id = products.restaurant_id and r.onboarding_completed = true
    )
  );

create policy "product_images_select_public" on public.product_images
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.restaurants r
      where r.id = product_images.restaurant_id and r.onboarding_completed = true
    )
  );

create policy "combos_select_public" on public.combos
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.restaurants r
      where r.id = combos.restaurant_id and r.onboarding_completed = true
    )
  );

create policy "combo_items_select_public" on public.combo_items
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.restaurants r
      where r.id = combo_items.restaurant_id and r.onboarding_completed = true
    )
  );

create policy "business_hours_select_public" on public.business_hours
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.restaurants r
      where r.id = business_hours.restaurant_id and r.onboarding_completed = true
    )
  );

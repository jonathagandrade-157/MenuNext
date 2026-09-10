-- MenuNext — Fase 1.5: infraestrutura de imagens/assets (Supabase Storage).
--
-- Escopo: só infraestrutura (bucket, tabela de imagens de produto, colunas
-- de branding no restaurante, policies). Nenhum CRUD de categorias/produtos/
-- adicionais/combos é implementado aqui.
--
-- Layout de paths no bucket `restaurant-assets` (bucket_id fixo, primeiro
-- segmento do path sempre = restaurant_id):
--   {restaurant_id}/branding/logo.{ext}
--   {restaurant_id}/branding/cover.{ext}
--   {restaurant_id}/products/{product_id}/{1..5}.{ext}
--   {restaurant_id}/banners/{asset_id}.{ext}
--
-- Reaproveita a arquitetura de tenant isolation já existente
-- (is_restaurant_member) em vez de criar uma segunda lógica de autorização.

-- ============================================================
-- 1. Branding do restaurante (logo/capa)
-- ============================================================
-- Sem tabela nova: o path é convencional por restaurante
-- ({restaurant_id}/branding/logo.*), mas a extensão real varia com o
-- formato enviado (jpeg/png/webp) — por isso guardamos o path completo
-- (com extensão) direto em `restaurants`, no mesmo padrão das demais
-- colunas de configuração dessa tabela (nullable, preenchidas aos poucos
-- durante o onboarding/painel).

alter table public.restaurants
  add column logo_path text,
  add column cover_path text;

-- ============================================================
-- 2. Imagens de produto (até 5 por produto)
-- ============================================================
-- `restaurant_id` é validado contra o produto de verdade via FK composta
-- (product_id, restaurant_id) -> products(id, restaurant_id): não basta o
-- cliente mandar um restaurant_id qualquer, ele precisa bater com o
-- restaurante real do produto — impossível cadastrar uma linha
-- "cross-tenant" mesmo por erro de aplicação, sem depender de trigger.
--
-- O limite de 5 imagens e a ordenação vêm do mesmo par de constraints:
-- display_order só pode ser 1..5 e é único por produto, então um produto
-- estrutural e automaticamente não pode ter uma 6ª linha.

alter table public.products
  add constraint products_id_restaurant_id_unique unique (id, restaurant_id);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  product_id uuid not null,
  storage_path text not null unique,
  display_order smallint not null check (display_order between 1 and 5),
  created_at timestamptz not null default now(),
  unique (product_id, display_order),
  foreign key (product_id, restaurant_id) references public.products (id, restaurant_id) on delete cascade
);

create index product_images_product_id_idx on public.product_images (product_id);
create index product_images_restaurant_id_idx on public.product_images (restaurant_id);

alter table public.product_images enable row level security;

-- Mesmo padrão de products/business_hours: CRUD liberado para membros do
-- restaurante dono das linhas.
create policy "product_images_select_members" on public.product_images
  for select to authenticated using (public.is_restaurant_member(restaurant_id));
create policy "product_images_insert_members" on public.product_images
  for insert to authenticated with check (public.is_restaurant_member(restaurant_id));
create policy "product_images_update_members" on public.product_images
  for update to authenticated using (public.is_restaurant_member(restaurant_id));
create policy "product_images_delete_members" on public.product_images
  for delete to authenticated using (public.is_restaurant_member(restaurant_id));

-- ============================================================
-- 3. Helper: extrai o restaurant_id do path de um objeto do Storage
-- ============================================================
-- Todo path no bucket restaurant-assets começa com "{restaurant_id}/...".
-- Função pura (sem leitura de tabela) usada só dentro das policies de
-- storage.objects abaixo. Retorna null (em vez de lançar exceção) quando o
-- primeiro segmento não é um uuid válido, para que a policy simplesmente
-- negue o acesso via is_restaurant_member(null) = false, sem quebrar a
-- query com um erro de cast.

create or replace function public.storage_path_restaurant_id(object_name text)
returns uuid
language plpgsql
immutable
set search_path to 'public'
as $$
begin
  return split_part(object_name, '/', 1)::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

revoke all on function public.storage_path_restaurant_id(text) from public, anon;
grant execute on function public.storage_path_restaurant_id(text) to authenticated;

-- ============================================================
-- 4. Bucket restaurant-assets
-- ============================================================
-- Público para leitura (a loja é pública), com limite de tamanho e MIME
-- types aceitos garantidos também pelo próprio Storage (defesa em
-- profundidade: não depende só da validação em TypeScript).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'restaurant-assets',
  'restaurant-assets',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- ============================================================
-- 5. Policies de storage.objects
-- ============================================================
-- Nenhuma policy de escrita usa USING/WITH CHECK (true): toda escrita
-- exige is_restaurant_member() sobre o restaurant_id extraído do próprio
-- path do objeto. Leitura é pública, mas restrita a este bucket
-- (bucket_id = 'restaurant-assets'), não a todos os buckets do projeto.
--
-- MASTER: o schema atual do MenuNext ainda não tem um papel MASTER real
-- (nenhuma coluna/role para isso existe em restaurant_members ou em
-- qualquer outra tabela — o próprio /master hoje só checa "está
-- autenticado", não um papel; ver comentário em src/app/master/layout.tsx).
-- Por isso NENHUMA policy de bypass para "master" foi criada aqui: seria
-- inventar um mecanismo de autorização que não existe. Isso é reportado
-- como achado estrutural, não decidido unilateralmente.

create policy "restaurant_assets_select_public"
  on storage.objects for select
  to public
  using (bucket_id = 'restaurant-assets');

create policy "restaurant_assets_insert_members"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'restaurant-assets'
    and public.is_restaurant_member(public.storage_path_restaurant_id(name))
  );

create policy "restaurant_assets_update_members"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'restaurant-assets'
    and public.is_restaurant_member(public.storage_path_restaurant_id(name))
  )
  with check (
    bucket_id = 'restaurant-assets'
    and public.is_restaurant_member(public.storage_path_restaurant_id(name))
  );

create policy "restaurant_assets_delete_members"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'restaurant-assets'
    and public.is_restaurant_member(public.storage_path_restaurant_id(name))
  );

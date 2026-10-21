-- MenuNext — produtos em destaque e banner promocional da loja.
--
-- Mudança aditiva e isolada (nenhuma função, política ou dado existente é alterado):
--   1) products.is_featured — o dono marca quais produtos aparecem em "Destaques" na loja.
--      A segurança já existente cobre a coluna nova: leitura pública segue a política
--      products_select_public e o guarda guard_owner_only_writes compara a LINHA INTEIRA
--      (só is_available pode mudar para STAFF), então STAFF não consegue marcar destaque.
--   2) restaurant_banners — uma linha por loja com o texto do banner (até 140 caracteres) e
--      a chave liga/desliga. Leitura: pública para loja visível, e dos membros (o dono
--      precisa ver a própria linha mesmo com a loja ainda em rascunho). Escrita: só OWNER.

alter table public.products
  add column if not exists is_featured boolean not null default false;

create table public.restaurant_banners (
  restaurant_id uuid primary key references public.restaurants (id) on delete cascade,
  is_enabled boolean not null default false,
  message text not null default '' check (char_length(message) <= 140),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.restaurant_banners enable row level security;

revoke all on public.restaurant_banners from public, anon, authenticated;
grant select on public.restaurant_banners to anon, authenticated;
grant insert, update on public.restaurant_banners to authenticated;

create policy restaurant_banners_select_public on public.restaurant_banners
  for select to anon, authenticated
  using (public.is_restaurant_publicly_visible(restaurant_id));

create policy restaurant_banners_select_members on public.restaurant_banners
  for select to authenticated
  using (public.is_restaurant_member(restaurant_id));

create policy restaurant_banners_insert_owner on public.restaurant_banners
  for insert to authenticated
  with check (public.is_restaurant_owner(restaurant_id));

create policy restaurant_banners_update_owner on public.restaurant_banners
  for update to authenticated
  using (public.is_restaurant_owner(restaurant_id))
  with check (public.is_restaurant_owner(restaurant_id));

create trigger set_updated_at before update on public.restaurant_banners
  for each row execute function public.set_updated_at();

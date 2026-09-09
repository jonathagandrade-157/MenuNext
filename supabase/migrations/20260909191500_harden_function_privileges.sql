-- MenuNext — Sprint 1: correção de achados do advisor de segurança do Supabase
-- após a migration inicial.
--
-- Achado 1 (function_search_path_mutable): set_updated_at() não tinha
-- search_path fixo.
--
-- Achado 2/3 (anon/authenticated_security_definer_function_executable): no
-- Supabase, o schema `public` tem ALTER DEFAULT PRIVILEGES concedendo EXECUTE
-- em novas funções diretamente para os roles `anon` e `authenticated` (não
-- via PUBLIC) — por isso `revoke ... from public` na migration anterior não
-- bastou para tirar o acesso de `anon`. Aqui revogamos explicitamente de
-- `anon` (e de `authenticated` no caso de handle_new_user, que só deve ser
-- chamada pelo trigger) e também restringimos as policies a `authenticated`.

alter function public.set_updated_at() set search_path = public;

-- handle_new_user: função de trigger (`returns trigger`), não deve ser
-- chamável via RPC por ninguém.
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- is_restaurant_member / is_slug_available / create_restaurant: uso interno
-- ou de onboarding, sempre com usuário autenticado. anon não precisa executar.
revoke all on function public.is_restaurant_member(uuid) from public, anon;
grant execute on function public.is_restaurant_member(uuid) to authenticated;

revoke all on function public.is_slug_available(text) from public, anon;
grant execute on function public.is_slug_available(text) to authenticated;

revoke all on function public.create_restaurant(text, text) from public, anon;
grant execute on function public.create_restaurant(text, text) to authenticated;

-- Restringe as policies explicitamente ao role `authenticated` (em vez de
-- PUBLIC), consistente com as revogações acima e evitando que `anon` sequer
-- tente avaliar is_restaurant_member().

drop policy "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (user_id = auth.uid());

drop policy "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (user_id = auth.uid());

drop policy "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (user_id = auth.uid());

drop policy "restaurants_select_members" on public.restaurants;
create policy "restaurants_select_members" on public.restaurants
  for select to authenticated using (public.is_restaurant_member(id));

drop policy "restaurants_update_members" on public.restaurants;
create policy "restaurants_update_members" on public.restaurants
  for update to authenticated using (public.is_restaurant_member(id));

drop policy "restaurant_members_select_related" on public.restaurant_members;
create policy "restaurant_members_select_related" on public.restaurant_members
  for select to authenticated using (
    user_id = auth.uid() or public.is_restaurant_member(restaurant_id)
  );

drop policy "onboarding_progress_select_members" on public.onboarding_progress;
create policy "onboarding_progress_select_members" on public.onboarding_progress
  for select to authenticated using (public.is_restaurant_member(restaurant_id));

drop policy "onboarding_progress_update_members" on public.onboarding_progress;
create policy "onboarding_progress_update_members" on public.onboarding_progress
  for update to authenticated using (public.is_restaurant_member(restaurant_id));

drop policy "business_hours_select_members" on public.business_hours;
create policy "business_hours_select_members" on public.business_hours
  for select to authenticated using (public.is_restaurant_member(restaurant_id));

drop policy "business_hours_insert_members" on public.business_hours;
create policy "business_hours_insert_members" on public.business_hours
  for insert to authenticated with check (public.is_restaurant_member(restaurant_id));

drop policy "business_hours_update_members" on public.business_hours;
create policy "business_hours_update_members" on public.business_hours
  for update to authenticated using (public.is_restaurant_member(restaurant_id));

drop policy "business_hours_delete_members" on public.business_hours;
create policy "business_hours_delete_members" on public.business_hours
  for delete to authenticated using (public.is_restaurant_member(restaurant_id));

drop policy "products_select_members" on public.products;
create policy "products_select_members" on public.products
  for select to authenticated using (public.is_restaurant_member(restaurant_id));

drop policy "products_insert_members" on public.products;
create policy "products_insert_members" on public.products
  for insert to authenticated with check (public.is_restaurant_member(restaurant_id));

drop policy "products_update_members" on public.products;
create policy "products_update_members" on public.products
  for update to authenticated using (public.is_restaurant_member(restaurant_id));

drop policy "products_delete_members" on public.products;
create policy "products_delete_members" on public.products
  for delete to authenticated using (public.is_restaurant_member(restaurant_id));

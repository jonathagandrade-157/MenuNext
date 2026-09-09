-- MenuNext — Sprint 1: otimização apontada pelo advisor de performance do
-- Supabase (auth_rls_initplan). `auth.uid()` chamado diretamente numa policy
-- é reavaliado por linha; `(select auth.uid())` deixa o planner cachear o
-- valor uma vez por statement.

drop policy "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (user_id = (select auth.uid()));

drop policy "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (user_id = (select auth.uid()));

drop policy "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy "restaurant_members_select_related" on public.restaurant_members;
create policy "restaurant_members_select_related" on public.restaurant_members
  for select to authenticated using (
    user_id = (select auth.uid()) or public.is_restaurant_member(restaurant_id)
  );

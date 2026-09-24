-- MenuNext — JON-9: controle de acesso real para o painel /master.
--
-- Antes desta migration, /master só checava se havia uma sessão autenticada
-- (getAuthedUser()) — qualquer usuário logado (inclusive um STAFF convidado
-- via JON-27, ou qualquer lojista de um piloto futuro) conseguia abrir as
-- rotas administrativas da plataforma. Gap já autodeclarado no próprio
-- código (ver JON-9).
--
-- MASTER é um papel de PLATAFORMA (dono/operador do SaaS), não um papel de
-- restaurante — por isso não vai em restaurant_members (que é por tenant),
-- e sim como uma flag em profiles (identidade da conta), mesmo lugar de
-- document/trial_status.

alter table public.profiles
  add column is_master boolean not null default false;

-- Helper no mesmo padrão de is_restaurant_member()/is_restaurant_owner():
-- SECURITY DEFINER + search_path fixo, para ser usado tanto em guardas de
-- página (via RPC) quanto em futuras RLS/RPCs administrativas.
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_master from public.profiles p where p.user_id = auth.uid()),
    false
  );
$$;

revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

-- Defesa em profundidade: mesmo padrão de restrict_profiles_update_columns
-- (Sprint 1) para document/trial — o próprio dono da linha nunca pode virar
-- MASTER sozinho via update direto de profiles; só um admin com acesso ao
-- SQL editor concede isso manualmente.
revoke update (is_master) on public.profiles from authenticated;
revoke update (is_master) on public.profiles from anon;

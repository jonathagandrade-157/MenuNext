-- ROLLBACK (NÃO é migration). Restaura is_platform_admin() original (migration 20260924010000) e remove o resto.
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

drop function if exists public.platform_get_require_aal2();
drop function if exists public.platform_set_require_aal2(boolean);
drop function if exists public.platform_admin_state();
drop function if exists public._platform_aal2_ok();
drop table if exists public.platform_security;

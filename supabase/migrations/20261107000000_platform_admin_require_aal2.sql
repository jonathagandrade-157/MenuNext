-- MenuNext — segundo fator (AAL2) EXIGIDO PELO BANCO para as funções administrativas da plataforma.
--
-- PROBLEMA: a exigência de MFA do aplicativo (MASTER_REQUIRE_MFA) só vale para as páginas e ações do app. Quem tem o
-- JWT de um administrador em AAL1 (só senha) ainda poderia chamar as funções master_*, update_platform_settings etc.
-- direto pela API do Supabase. Todas elas (e as políticas do Master) dependem de public.is_platform_admin(), que tem UMA
-- definição. Esta migration a redefine: quando a exigência está LIGADA, só é administrador quem tem `aal = 'aal2'`
-- no JWT (segundo fator verificado nesta sessão).
--
-- COMPORTAMENTO
--   * DESLIGADA POR PADRÃO (platform_security.require_aal2 = false): nada muda até um administrador ligar.
--   * Ligar/desligar: platform_set_require_aal2(boolean) — exige is_platform_admin() E aal2 na sessão que liga. Isto
--     é o anti-trancamento: só liga quem acabou de provar que o segundo fator FUNCIONA.
--   * platform_admin_state() devolve 'not_admin' | 'mfa_required' | 'admin' para o app encaminhar o administrador em
--     AAL1 à tela de segundo fator (sem ela ele seria tratado como "não administrador").
--   * RECUPERAÇÃO (perdeu o autenticador): quem tem acesso de dono ao banco (SQL Editor / service role) executa
--       update public.platform_security set require_aal2 = false;
--     A tabela não tem privilégio para anon/authenticated: nem o administrador a lê ou altera direto.
--   * A exigência vale para QUALQUER chamada que use is_platform_admin() com um JWT de usuário. Não afeta webhooks,
--     cron nem rotinas com service_role (não usam is_platform_admin()), nem acesso de dono do banco.
-- Nunca aplicada em produção por este repositório; validada em PostgreSQL sintético (supabase/tests/platform_mfa.sql).

create table public.platform_security (
  id boolean primary key default true check (id), -- singleton
  require_aal2 boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

insert into public.platform_security (id) values (true);

alter table public.platform_security enable row level security;
revoke all on public.platform_security from public, anon, authenticated;

create trigger set_updated_at before update on public.platform_security
  for each row execute function public.set_updated_at();

-- Interna: a sessão atual satisfaz a exigência? (JWT sem a claim `aal` conta como AAL1.)
create or replace function public._platform_aal2_ok()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not coalesce((select s.require_aal2 from public.platform_security s), false)
      or coalesce(nullif(auth.jwt() ->> 'aal', ''), 'aal1') = 'aal2';
$$;

revoke all on function public._platform_aal2_ok() from public, anon, authenticated;

-- Mesma assinatura e mesmos privilégios da original; só acrescenta a exigência de AAL2 quando ligada.
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_master from public.profiles p where p.user_id = auth.uid()), false)
     and public._platform_aal2_ok();
$$;

revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

create or replace function public.platform_admin_state()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not coalesce((select p.is_master from public.profiles p where p.user_id = auth.uid()), false) then 'not_admin'
    when public._platform_aal2_ok() then 'admin'
    else 'mfa_required'
  end;
$$;

revoke all on function public.platform_admin_state() from public, anon;
grant execute on function public.platform_admin_state() to authenticated;

create or replace function public.platform_set_require_aal2(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_enabled is null then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  -- is_platform_admin() já exige AAL2 se a exigência estiver ligada; o teste explícito abaixo vale também para LIGAR.
  if not public.is_platform_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if coalesce(nullif(auth.jwt() ->> 'aal', ''), 'aal1') <> 'aal2' then
    raise exception 'aal2_required' using errcode = '42501';
  end if;
  update public.platform_security set require_aal2 = p_enabled, updated_by = auth.uid() where id;
  return p_enabled;
end;
$$;

revoke all on function public.platform_set_require_aal2(boolean) from public, anon;
grant execute on function public.platform_set_require_aal2(boolean) to authenticated;

-- Leitura do estado da exigência (só administrador; a tabela em si continua fechada).
create or replace function public.platform_get_require_aal2()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return coalesce((select s.require_aal2 from public.platform_security s), false);
end;
$$;

revoke all on function public.platform_get_require_aal2() from public, anon;
grant execute on function public.platform_get_require_aal2() to authenticated;

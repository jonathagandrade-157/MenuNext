-- MenuNext — Contato de suporte configurável pelo MASTER (usado em
-- /painel/ajuda). Singleton table (id boolean fixo em true — só uma linha
-- possível) porque é uma configuração da PLATAFORMA, não de um restaurante:
-- mesmo padrão de "flag única" já usado para outras coisas globais no
-- projeto (nenhuma tabela por-tenant faria sentido aqui).
--
-- Leitura liberada a qualquer autenticado (STAFF/OWNER precisam ver o
-- contato de suporte na tela Ajuda); escrita só via RPC SECURITY DEFINER
-- restrita a is_platform_admin() (JON-9) — sem policy de update direta,
-- mesmo padrão de restaurant_invites/restaurant_members.

create table public.platform_settings (
  id boolean primary key default true check (id),
  support_email text,
  support_whatsapp text,
  updated_at timestamptz not null default now()
);

insert into public.platform_settings (id) values (true);

create trigger set_updated_at before update on public.platform_settings
  for each row execute function public.set_updated_at();

alter table public.platform_settings enable row level security;

create policy "platform_settings_select_authenticated" on public.platform_settings
  for select to authenticated using (true);

create or replace function public.update_platform_settings(p_support_email text, p_support_whatsapp text)
returns public.platform_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := nullif(trim(p_support_email), '');
  v_whatsapp text := nullif(regexp_replace(coalesce(p_support_whatsapp, ''), '\D', '', 'g'), '');
  v_row public.platform_settings;
begin
  if not public.is_platform_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email' using errcode = '22023';
  end if;

  update public.platform_settings
  set support_email = v_email, support_whatsapp = v_whatsapp
  where id = true
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.update_platform_settings(text, text) from public, anon;
grant execute on function public.update_platform_settings(text, text) to authenticated;

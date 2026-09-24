-- Backfill: esta migration já estava aplicada no projeto (via apply_migration,
-- por uma sessão anterior do Claude Code) quando este arquivo foi adicionado
-- ao repositório — reproduz exatamente o SQL executado, para manter
-- supabase/migrations como fonte fiel do estado real do banco (mesmo drift
-- identificado e corrigido em JON-5, desta vez para o schema de convites da
-- JON-27).

-- MenuNext — JON-27: convite de equipe (Usuários e permissões, /painel/usuarios).
--
-- Inspeção prévia: restaurant_members.user_id é NOT NULL references
-- auth.users — um convite pendente não tem (e pode nunca vir a ter, se
-- revogado/expirado) uma conta associada, então não existe como representar
-- "convite pendente" numa linha de restaurant_members. Precisa de tabela
-- nova.
--
-- Decisões já registradas no Linear (JON-27), não redebatidas aqui:
-- - create_restaurant_invite só cria convite com role = 'STAFF' (convidar
--   um segundo OWNER fica fora deste ticket).
-- - Convidado sem conta passa pelo signUp() padrão, COM CPF/CNPJ —
--   handle_new_user() e a trigger on_auth_user_created NÃO são tocados
--   aqui. Pular CPF para convidado é JON-31 (Backlog), fora de escopo.
-- - Envio de e-mail real (Resend) fica para depois (falta domínio
--   verificado) — o "link de convite" é só copiado/compartilhado
--   manualmente pelo lojista por enquanto; nada aqui impede plugar o envio
--   depois (a RPC já devolve o token/link pronto).
--
-- Reaproveita:
-- - is_restaurant_member() para leitura (SELECT) da nova tabela.
-- - set_updated_at() (já existe desde a Sprint 1) para o trigger de updated_at.
-- - Mesmo padrão de RPC SECURITY DEFINER com search_path fixo usado em toda
--   escrita sensível do projeto (create_restaurant, advance_order_status).
-- - Mesmo padrão de RPC pública (grant a anon+authenticated) usado em
--   get_public_order/get_public_restaurant_by_slug, para a página
--   /convite/[token] funcionar sem sessão.
-- - A restrição de "1 usuário = 1 restaurante" já embutida em
--   create_restaurant() (se o usuário já é membro de algum restaurante,
--   nunca cria/associa outro) e em getMyRestaurant() (.maybeSingle(), que
--   quebraria com 2 linhas) — accept_restaurant_invite() bloqueia
--   explicitamente quem já é membro de QUALQUER restaurante, para nunca
--   colocar o app nesse estado inconsistente.

-- ============================================================
-- 1. restaurant_invites
-- ============================================================
create table public.restaurant_invites (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  email text not null check (email = lower(trim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role text not null default 'STAFF' check (role in ('OWNER', 'STAFF')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked')),
  token uuid not null unique default gen_random_uuid(),
  invited_by uuid not null references auth.users (id) on delete set null,
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index restaurant_invites_restaurant_id_idx on public.restaurant_invites (restaurant_id);

-- Só um convite PENDENTE por e-mail por restaurante — índice parcial (não
-- unique da tabela toda) para permitir reconvidar depois de
-- expirado/revogado/aceito, sem nunca ter duas linhas "pending" para o
-- mesmo e-mail no mesmo restaurante ao mesmo tempo.
create unique index restaurant_invites_pending_email_idx
  on public.restaurant_invites (restaurant_id, email)
  where status = 'pending';

create trigger set_updated_at before update on public.restaurant_invites
  for each row execute function public.set_updated_at();

alter table public.restaurant_invites enable row level security;

-- Só leitura direta para membros do restaurante (lista em /painel/usuarios,
-- igual a qualquer outra tabela do painel). Sem policy de
-- insert/update/delete: toda escrita passa pelas RPCs abaixo (mesmo padrão
-- de restaurant_members/order_counters — só o dono postgres, via SECURITY
-- DEFINER, escreve nesta tabela).
create policy "restaurant_invites_select_members" on public.restaurant_invites
  for select to authenticated using (public.is_restaurant_member(restaurant_id));

-- ============================================================
-- 2. create_restaurant_invite — só o OWNER do restaurante convida, e só com
--    role STAFF (decisão do JON-27: convidar outro OWNER é fora de escopo).
-- ============================================================
create or replace function public.create_restaurant_invite(p_email text)
returns public.restaurant_invites
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_restaurant_id uuid;
  v_role text;
  v_email text := lower(trim(p_email));
  v_invite public.restaurant_invites;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select rm.restaurant_id, rm.role into v_restaurant_id, v_role
  from public.restaurant_members rm
  where rm.user_id = auth.uid()
  limit 1;

  if v_restaurant_id is null or v_role <> 'OWNER' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email' using errcode = '22023';
  end if;

  -- E-mail já é membro deste mesmo restaurante (via auth.users — profiles
  -- não guarda e-mail; SECURITY DEFINER é o que permite este join).
  if exists (
    select 1
    from public.restaurant_members rm
    join auth.users u on u.id = rm.user_id
    where rm.restaurant_id = v_restaurant_id
      and lower(u.email) = v_email
  ) then
    raise exception 'already_member' using errcode = '23505';
  end if;

  insert into public.restaurant_invites (restaurant_id, email, role, invited_by)
  values (v_restaurant_id, v_email, 'STAFF', auth.uid())
  returning * into v_invite;

  return v_invite;
exception
  when unique_violation then
    raise exception 'invite_already_pending' using errcode = '23505';
end;
$$;

revoke all on function public.create_restaurant_invite(text) from public, anon;
grant execute on function public.create_restaurant_invite(text) to authenticated;

-- ============================================================
-- 3. resend_restaurant_invite — regenera token+expiração NA MESMA linha
--    (nunca cria uma segunda). Só o OWNER do restaurante do convite.
-- ============================================================
create or replace function public.resend_restaurant_invite(p_invite_id uuid)
returns public.restaurant_invites
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_invite public.restaurant_invites;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_invite from public.restaurant_invites where id = p_invite_id for update;

  if v_invite.id is null then
    raise exception 'invite_not_found' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.restaurant_members rm
    where rm.restaurant_id = v_invite.restaurant_id and rm.user_id = auth.uid() and rm.role = 'OWNER'
  ) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'invite_not_pending' using errcode = '22023';
  end if;

  update public.restaurant_invites set
    token = gen_random_uuid(),
    expires_at = now() + interval '7 days'
  where id = v_invite.id
  returning * into v_invite;

  return v_invite;
end;
$$;

revoke all on function public.resend_restaurant_invite(uuid) from public, anon;
grant execute on function public.resend_restaurant_invite(uuid) to authenticated;

-- ============================================================
-- 4. revoke_restaurant_invite — só o OWNER do restaurante do convite.
-- ============================================================
create or replace function public.revoke_restaurant_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_invite public.restaurant_invites;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_invite from public.restaurant_invites where id = p_invite_id for update;

  if v_invite.id is null then
    raise exception 'invite_not_found' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.restaurant_members rm
    where rm.restaurant_id = v_invite.restaurant_id and rm.user_id = auth.uid() and rm.role = 'OWNER'
  ) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'invite_not_pending' using errcode = '22023';
  end if;

  update public.restaurant_invites set status = 'revoked' where id = v_invite.id;
end;
$$;

revoke all on function public.revoke_restaurant_invite(uuid) from public, anon;
grant execute on function public.revoke_restaurant_invite(uuid) to authenticated;

-- ============================================================
-- 5. get_restaurant_invite_by_token — pública (anon + authenticated): a
--    página /convite/[token] precisa ler o convite ANTES de existir
--    sessão. Devolve só o mínimo pra renderizar a tela (nome do
--    restaurante, e-mail e role convidados, status EFETIVO) — nunca a
--    linha inteira, nunca dados de outros convites. "expired" aqui é
--    calculado na leitura (comparando expires_at com now()), não é escrito
--    na coluna — não há job/cron neste projeto para fazer essa escrita, e
--    não precisa: toda leitura/decisão já considera a data.
-- ============================================================
create or replace function public.get_restaurant_invite_by_token(p_token uuid)
returns table (
  restaurant_id uuid,
  restaurant_name text,
  email text,
  role text,
  status text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    ri.restaurant_id,
    r.name as restaurant_name,
    ri.email,
    ri.role,
    case
      when ri.status = 'pending' and ri.expires_at < now() then 'expired'
      else ri.status
    end as status
  from public.restaurant_invites ri
  join public.restaurants r on r.id = ri.restaurant_id
  where ri.token = p_token;
$$;

revoke all on function public.get_restaurant_invite_by_token(uuid) from public;
grant execute on function public.get_restaurant_invite_by_token(uuid) to anon, authenticated;

-- ============================================================
-- 6. accept_restaurant_invite — única forma de transformar um convite em
--    restaurant_members. Confere (nesta ordem): convite existe e está
--    efetivamente pendente; e-mail da CONTA LOGADA (lido de auth.users,
--    nunca de um campo enviado pelo cliente) bate com o e-mail convidado;
--    o usuário logado ainda não é membro de NENHUM restaurante (a
--    premissa de 1 usuário = 1 restaurante que create_restaurant() e
--    getMyRestaurant() já assumem em todo o app).
-- ============================================================
create or replace function public.accept_restaurant_invite(p_token uuid)
returns public.restaurant_members
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_invite public.restaurant_invites;
  v_caller_email text;
  v_member public.restaurant_members;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_invite from public.restaurant_invites where token = p_token for update;

  if v_invite.id is null then
    raise exception 'invite_not_found' using errcode = '22023';
  end if;

  if v_invite.status = 'accepted' then
    raise exception 'invite_already_used' using errcode = '22023';
  end if;

  if v_invite.status = 'revoked' then
    raise exception 'invite_revoked' using errcode = '22023';
  end if;

  if v_invite.status <> 'pending' or v_invite.expires_at < now() then
    raise exception 'invite_expired' using errcode = '22023';
  end if;

  select lower(email) into v_caller_email from auth.users where id = auth.uid();

  if v_caller_email is distinct from v_invite.email then
    raise exception 'email_mismatch' using errcode = '42501';
  end if;

  if exists (select 1 from public.restaurant_members where user_id = auth.uid()) then
    raise exception 'already_member' using errcode = '23505';
  end if;

  insert into public.restaurant_members (restaurant_id, user_id, role)
  values (v_invite.restaurant_id, auth.uid(), v_invite.role)
  returning * into v_member;

  update public.restaurant_invites set
    status = 'accepted',
    accepted_at = now(),
    accepted_by = auth.uid()
  where id = v_invite.id;

  return v_member;
end;
$$;

revoke all on function public.accept_restaurant_invite(uuid) from public, anon;
grant execute on function public.accept_restaurant_invite(uuid) to authenticated;

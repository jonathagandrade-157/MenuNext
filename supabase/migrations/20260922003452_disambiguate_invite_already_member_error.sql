-- Backfill: esta migration já estava aplicada no projeto quando este
-- arquivo foi adicionado ao repositório — reproduz exatamente o SQL
-- executado (ver 20260922003037_add_restaurant_invites.sql).

-- MenuNext — JON-27: accept_restaurant_invite() usava 'already_member' tanto
-- para "e-mail convidado já é membro deste restaurante" (erro de
-- create_restaurant_invite) quanto para "usuário logado já é membro de
-- QUALQUER restaurante" (bloqueio de accept_restaurant_invite) — o mesmo
-- código confundia dois casos distintos na tela. Renomeado para
-- 'already_has_restaurant' aqui para o cliente distinguir as duas mensagens.
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
    raise exception 'already_has_restaurant' using errcode = '23505';
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

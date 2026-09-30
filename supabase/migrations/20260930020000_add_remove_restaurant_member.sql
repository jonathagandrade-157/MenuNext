-- MenuNext — Usuários e permissões (redesign, área "Usuários" do roadmap
-- Stitch): até aqui restaurant_members só tinha INSERT (create_restaurant/
-- accept_restaurant_invite), nunca uma forma de o OWNER remover um STAFF da
-- equipe. Mesmo padrão SECURITY DEFINER de revoke_restaurant_invite
-- (20260922003037_add_restaurant_invites.sql): deriva o restaurante do
-- OWNER chamador via restaurant_members, nunca recebe restaurant_id do
-- cliente. A remoção é um DELETE direto na linha — todo acesso ao painel já
-- é condicionado à existência dessa linha (is_restaurant_member()/RLS), então
-- o efeito é imediato, sem precisar de coluna nova nem de mexer em policy.
create or replace function public.remove_restaurant_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller_restaurant_id uuid;
  v_caller_role text;
  v_member public.restaurant_members;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select rm.restaurant_id, rm.role into v_caller_restaurant_id, v_caller_role
  from public.restaurant_members rm
  where rm.user_id = auth.uid()
  limit 1;

  if v_caller_restaurant_id is null or v_caller_role <> 'OWNER' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into v_member from public.restaurant_members where id = p_member_id for update;

  if v_member.id is null or v_member.restaurant_id <> v_caller_restaurant_id then
    raise exception 'member_not_found' using errcode = '22023';
  end if;

  if v_member.role = 'OWNER' then
    raise exception 'cannot_remove_owner' using errcode = '42501';
  end if;

  delete from public.restaurant_members where id = v_member.id;
end;
$$;

revoke all on function public.remove_restaurant_member(uuid) from public, anon;
grant execute on function public.remove_restaurant_member(uuid) to authenticated;

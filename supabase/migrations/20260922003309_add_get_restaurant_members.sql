-- Backfill: esta migration já estava aplicada no projeto quando este
-- arquivo foi adicionado ao repositório — reproduz exatamente o SQL
-- executado (ver 20260922003037_add_restaurant_invites.sql).

-- MenuNext — JON-27: listar a equipe em /painel/usuarios.
--
-- Achado durante a implementação (não estava no desenho original): a
-- policy "profiles_select_own" (Sprint 1) só deixa cada usuário ler o
-- PRÓPRIO profile — um STAFF não consegue ver o nome de outro membro do
-- mesmo restaurante via select direto, e profiles não guarda e-mail (só
-- auth.users). Sem isso, /painel/usuarios não teria nome nenhum pra
-- mostrar além do próprio usuário logado.
--
-- Em vez de afrouxar profiles_select_own (policy sensível, fora do escopo
-- combinado para esta tarefa), esta RPC expõe só o necessário: nome,
-- telefone, e-mail e role de cada membro do MESMO restaurante do
-- chamador — nunca de outro tenant, nunca a linha inteira de profiles ou
-- auth.users. Mesmo padrão de create_restaurant_invite (deriva o
-- restaurant_id do caller via restaurant_members, nunca recebe um
-- restaurant_id do cliente).
create or replace function public.get_restaurant_members()
returns table (
  id uuid,
  user_id uuid,
  role text,
  name text,
  phone text,
  email text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select rm.id, rm.user_id, rm.role, p.name, p.phone, u.email, rm.created_at
  from public.restaurant_members rm
  join auth.users u on u.id = rm.user_id
  left join public.profiles p on p.user_id = rm.user_id
  where rm.restaurant_id in (
    select restaurant_id from public.restaurant_members where user_id = auth.uid()
  )
  order by rm.created_at;
$$;

revoke all on function public.get_restaurant_members() from public, anon;
grant execute on function public.get_restaurant_members() to authenticated;

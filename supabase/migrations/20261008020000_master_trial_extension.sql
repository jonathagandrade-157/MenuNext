-- MenuNext — cortesia de trial: o master prorroga o teste gratuito de uma loja.
--
-- O trial mora no perfil do OWNER (profiles.trial_ends_at, protegido contra
-- UPDATE direto). Sem esta RPC, uma loja sem plano que chegasse ao fim do
-- trial só se desbloquearia assinando pelo Asaas; o master não tinha como
-- conceder mais prazo.
--
-- Regras:
-- - Só o master (is_platform_admin()) prorroga, de 1 a 365 dias.
-- - O prazo soma em cima do que ainda resta; trial já vencido (ou inexistente)
--   conta a partir de agora, e nunca encurta um trial em andamento.
-- - Loja com plano não precisa de cortesia (o trial só governa quem não tem
--   plano), então a RPC recusa em vez de gravar algo sem efeito.
-- - O trial é do OWNER: se ele tiver mais de uma loja, todas ganham o prazo.
-- - Cada cortesia fica registrada em trial_extensions (quem, quando, quanto),
--   para a futura tela de Auditoria; a tabela não tem acesso direto.

create table public.trial_extensions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  owner_user_id uuid not null,
  granted_by uuid not null,
  days integer not null check (days between 1 and 365),
  previous_ends_at timestamptz,
  new_ends_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index trial_extensions_restaurant_id_idx on public.trial_extensions (restaurant_id, created_at desc);

-- RLS ligada e sem policies de propósito (mesmo padrão de billing_settings):
-- só as funções SECURITY DEFINER abaixo escrevem/leem.
alter table public.trial_extensions enable row level security;
revoke all on table public.trial_extensions from anon, authenticated;

-- ============================================================
-- Fim do trial do OWNER da loja (null = sem trial ou loja inexistente).
-- ============================================================
create or replace function public.master_get_restaurant_trial(p_restaurant_id uuid)
returns timestamptz
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_ends timestamptz;
begin
  if not public.is_platform_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select p.trial_ends_at into v_ends
  from public.restaurant_members rm
  join public.profiles p on p.user_id = rm.user_id
  where rm.restaurant_id = p_restaurant_id and rm.role = 'OWNER'
  order by rm.created_at
  limit 1;

  return v_ends;
end;
$$;

revoke all on function public.master_get_restaurant_trial(uuid) from public, anon;
grant execute on function public.master_get_restaurant_trial(uuid) to authenticated;

-- ============================================================
-- Prorroga o trial; devolve o novo fim do trial.
-- ============================================================
create or replace function public.master_extend_trial(p_restaurant_id uuid, p_days integer)
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_plan_id uuid;
  v_owner uuid;
  v_previous timestamptz;
  v_new timestamptz;
begin
  if not public.is_platform_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'invalid_days' using errcode = '22023';
  end if;

  select r.plan_id into v_plan_id from public.restaurants r where r.id = p_restaurant_id;
  if not found then
    raise exception 'restaurant_not_found' using errcode = 'P0002';
  end if;
  if v_plan_id is not null then
    raise exception 'has_plan' using errcode = '55000';
  end if;

  select rm.user_id into v_owner
  from public.restaurant_members rm
  where rm.restaurant_id = p_restaurant_id and rm.role = 'OWNER'
  order by rm.created_at
  limit 1;
  if not found then
    raise exception 'no_owner' using errcode = 'P0002';
  end if;

  select p.trial_ends_at into v_previous
  from public.profiles p
  where p.user_id = v_owner
  for update;
  if not found then
    raise exception 'no_owner' using errcode = 'P0002';
  end if;

  v_new := greatest(coalesce(v_previous, now()), now()) + make_interval(days => p_days);

  update public.profiles set trial_ends_at = v_new where user_id = v_owner;

  insert into public.trial_extensions (restaurant_id, owner_user_id, granted_by, days, previous_ends_at, new_ends_at)
  values (p_restaurant_id, v_owner, auth.uid(), p_days, v_previous, v_new);

  return v_new;
end;
$$;

revoke all on function public.master_extend_trial(uuid, integer) from public, anon;
grant execute on function public.master_extend_trial(uuid, integer) to authenticated;

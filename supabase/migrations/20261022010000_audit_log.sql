-- MenuNext — registro de auditoria (quem alterou o quê, e quando).
--
-- Mudança aditiva: uma tabela nova, uma função de gatilho e duas funções de leitura. Nenhuma tabela
-- de negócio muda de estrutura; os gatilhos são AFTER (rodam só depois de a escrita já ter passado
-- por RLS e pelos guardas existentes) e nunca bloqueiam a operação: qualquer falha ao registrar é
-- engolida (um buraco no registro é preferível a recusar um pedido ou uma edição do lojista).
--
-- O QUE É REGISTRADO
--   * Só ações de pessoas (JWT presente, auth.uid() não nulo). Backend, webhooks e migrações
--     (service_role / sem JWT) ficam fora: seriam ruído e não têm "autor".
--   * Só tabelas de configuração do restaurante — NUNCA orders/order_items (caminho quente do produto).
--   * Para alterações, só os NOMES das colunas mudadas (nunca os valores): custo, chave Pix e afins
--     não vazam para o registro. Mudanças só de updated_at ou de display_order (reordenar) não contam.
--
-- QUEM LÊ
--   * A tabela não tem política nem privilégio para anon/authenticated: só funções SECURITY DEFINER.
--   * restaurant_audit_recent(): o OWNER lê o registro da PRÓPRIA loja (STAFF e outros recebem vazio).
--   * master_audit_list(): só master da plataforma (is_platform_admin), com filtro opcional por loja.

create table public.audit_log (
  id bigint generated always as identity primary key,
  restaurant_id uuid references public.restaurants (id) on delete cascade,
  actor_user_id uuid,
  actor_role text,
  action text not null check (action in ('insert', 'update', 'delete')),
  entity text not null,
  entity_id uuid,
  summary text not null check (char_length(summary) <= 300),
  created_at timestamptz not null default now()
);

create index audit_log_restaurant_idx on public.audit_log (restaurant_id, created_at desc, id desc);
create index audit_log_created_idx on public.audit_log (created_at desc, id desc);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from public, anon, authenticated;

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_restaurant uuid;
  v_entity_id uuid;
  v_name text;
  v_label text;
  v_role text;
  v_changed text;
  v_summary text;
begin
  -- Sem JWT (backend, webhooks, migrações): fora do registro.
  if v_uid is null then
    return coalesce(new, old);
  end if;

  begin
    v_old := case when tg_op <> 'INSERT' then to_jsonb(old) end;
    v_new := case when tg_op <> 'DELETE' then to_jsonb(new) end;
    v_row := coalesce(v_new, v_old);

    v_restaurant := case tg_table_name
      when 'restaurants' then (v_row ->> 'id')::uuid
      else (v_row ->> 'restaurant_id')::uuid
    end;
    v_entity_id := coalesce((v_row ->> 'id')::uuid, (v_row ->> 'restaurant_id')::uuid);

    if tg_op = 'UPDATE' then
      select string_agg(ks.k, ', ' order by ks.k)
        into v_changed
        from jsonb_object_keys(v_new) as ks(k)
       where ks.k not in ('updated_at', 'display_order')
         and (v_new -> ks.k) is distinct from (v_old -> ks.k);
      -- só updated_at / ordem mudaram: não é uma alteração que valha registro
      if v_changed is null then
        return new;
      end if;
    end if;

    v_label := case tg_table_name
      when 'products' then 'Produto'
      when 'categories' then 'Categoria'
      when 'combos' then 'Combo'
      when 'coupons' then 'Cupom'
      when 'delivery_zones' then 'Zona de entrega'
      when 'restaurants' then 'Dados da loja'
      when 'restaurant_members' then 'Membro da equipe'
      when 'restaurant_invites' then 'Convite'
      when 'restaurant_banners' then 'Banner da loja'
      when 'addon_groups' then 'Grupo de adicionais'
      when 'addons' then 'Adicional'
      else tg_table_name
    end;

    v_name := case tg_table_name
      when 'coupons' then v_row ->> 'code'
      when 'delivery_zones' then v_row ->> 'neighborhood'
      when 'restaurant_members' then v_row ->> 'role'
      when 'restaurant_invites' then v_row ->> 'email'
      when 'restaurant_banners' then null
      when 'restaurants' then null
      else v_row ->> 'name'
    end;

    v_summary := v_label
      || case when v_name is not null and v_name <> '' then ' "' || left(v_name, 60) || '"' else '' end
      || ' '
      || case tg_op
           when 'INSERT' then 'criado'
           when 'DELETE' then 'removido'
           else 'alterado (' || left(v_changed, 150) || ')'
         end;

    select m.role into v_role
      from public.restaurant_members m
     where m.restaurant_id = v_restaurant and m.user_id = v_uid;
    if v_role is null and public.is_platform_admin() then
      v_role := 'MASTER';
    end if;

    insert into public.audit_log (restaurant_id, actor_user_id, actor_role, action, entity, entity_id, summary)
    values (v_restaurant, v_uid, v_role, lower(tg_op), tg_table_name, v_entity_id, v_summary);
  exception when others then
    null; -- registrar nunca pode impedir a operação do lojista
  end;

  return coalesce(new, old);
end;
$$;

revoke all on function public.audit_row_change() from public, anon, authenticated;

create trigger audit_products after insert or update or delete on public.products
  for each row execute function public.audit_row_change();
create trigger audit_categories after insert or update or delete on public.categories
  for each row execute function public.audit_row_change();
create trigger audit_combos after insert or update or delete on public.combos
  for each row execute function public.audit_row_change();
create trigger audit_coupons after insert or update or delete on public.coupons
  for each row execute function public.audit_row_change();
create trigger audit_delivery_zones after insert or update or delete on public.delivery_zones
  for each row execute function public.audit_row_change();
create trigger audit_addon_groups after insert or update or delete on public.addon_groups
  for each row execute function public.audit_row_change();
create trigger audit_addons after insert or update or delete on public.addons
  for each row execute function public.audit_row_change();
create trigger audit_restaurants after update on public.restaurants
  for each row execute function public.audit_row_change();
create trigger audit_restaurant_members after insert or update or delete on public.restaurant_members
  for each row execute function public.audit_row_change();
create trigger audit_restaurant_invites after insert or update on public.restaurant_invites
  for each row execute function public.audit_row_change();
create trigger audit_restaurant_banners after insert or update on public.restaurant_banners
  for each row execute function public.audit_row_change();

-- Registro recente da PRÓPRIA loja, para o OWNER. Quem não é OWNER recebe lista vazia.
create or replace function public.restaurant_audit_recent(p_limit integer default 20)
returns table (
  created_at timestamptz,
  actor_name text,
  actor_role text,
  action text,
  entity text,
  summary text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select a.created_at,
         coalesce(nullif(p.name, ''), 'Usuário') as actor_name,
         a.actor_role,
         a.action,
         a.entity,
         a.summary
    from public.audit_log a
    left join public.profiles p on p.user_id = a.actor_user_id
   where a.restaurant_id = (
           select rm.restaurant_id
             from public.restaurant_members rm
            where rm.user_id = auth.uid() and rm.role = 'OWNER'
            limit 1
         )
   order by a.created_at desc, a.id desc
   limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

revoke all on function public.restaurant_audit_recent(integer) from public, anon;
grant execute on function public.restaurant_audit_recent(integer) to authenticated;

-- Registro de toda a plataforma, só para o master (com filtro opcional por loja).
create or replace function public.master_audit_list(
  p_limit integer default 50,
  p_offset integer default 0,
  p_restaurant uuid default null
)
returns table (
  created_at timestamptz,
  restaurant_id uuid,
  restaurant_name text,
  actor_name text,
  actor_role text,
  action text,
  entity text,
  summary text,
  total bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not_authorized: apenas o master da plataforma' using errcode = '42501';
  end if;

  return query
    select a.created_at,
           a.restaurant_id,
           r.name as restaurant_name,
           coalesce(nullif(p.name, ''), 'Usuário') as actor_name,
           a.actor_role,
           a.action,
           a.entity,
           a.summary,
           count(*) over () as total
      from public.audit_log a
      left join public.restaurants r on r.id = a.restaurant_id
      left join public.profiles p on p.user_id = a.actor_user_id
     where p_restaurant is null or a.restaurant_id = p_restaurant
     order by a.created_at desc, a.id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.master_audit_list(integer, integer, uuid) from public, anon;
grant execute on function public.master_audit_list(integer, integer, uuid) to authenticated;

-- MenuNext — suporte: chamados dos lojistas e atendimento da plataforma.
--
-- ADITIVA: só tabelas e funções novas. Nada existente é alterado.
--   * support_tickets / support_messages: leitura só pelo OWNER da loja dona do chamado e por admins da plataforma
--     (is_platform_admin). Escrita NUNCA direta: só pelas funções abaixo (SECURITY DEFINER).
--   * O lojista (OWNER) abre chamados (prioridade low/normal/high), responde e pode ENCERRAR o próprio chamado.
--     STAFF não acessa. Só a plataforma define prioridade "urgent", muda para os demais status e lista tudo.
--   * Limites contra abuso: no máximo 10 chamados abertos por loja e 20 mensagens por hora por chamado (lojista).
--   * Mensagens são append-only (sem edição nem exclusão).
-- Nunca aplicada em produção por este repositório; validada em PostgreSQL sintético (supabase/tests/support_tickets.sql).

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  subject text not null check (char_length(subject) between 3 and 120),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'open' check (status in ('open', 'waiting_customer', 'resolved', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  closed_at timestamptz,
  check ((status = 'closed') = (closed_at is not null))
);

create index support_tickets_restaurant_idx on public.support_tickets (restaurant_id, last_message_at desc);
create index support_tickets_status_idx on public.support_tickets (status, last_message_at desc);

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  author_id uuid references auth.users (id) on delete set null,
  author_kind text not null check (author_kind in ('merchant', 'platform')),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index support_messages_ticket_idx on public.support_messages (ticket_id, created_at);

alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
revoke all on public.support_tickets from public, anon, authenticated;
revoke all on public.support_messages from public, anon, authenticated;
grant select on public.support_tickets to authenticated;
grant select on public.support_messages to authenticated;

create policy support_tickets_select on public.support_tickets
  for select to authenticated
  using (public.is_restaurant_owner(restaurant_id) or public.is_platform_admin());

create policy support_messages_select on public.support_messages
  for select to authenticated
  using (public.is_restaurant_owner(restaurant_id) or public.is_platform_admin());

-- Abre um chamado para a loja em que o chamador é OWNER, com a primeira mensagem.
create or replace function public.support_create_ticket(p_subject text, p_body text, p_priority text default 'normal')
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_restaurant uuid;
  v_subject text := btrim(coalesce(p_subject, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  select rm.restaurant_id into v_restaurant
    from public.restaurant_members rm
   where rm.user_id = auth.uid() and rm.role = 'OWNER'
   limit 1;
  if v_restaurant is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if char_length(v_subject) < 3 or char_length(v_subject) > 120 then
    raise exception 'invalid_subject' using errcode = '22023';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 4000 then
    raise exception 'invalid_body' using errcode = '22023';
  end if;
  if p_priority is null or p_priority not in ('low', 'normal', 'high') then
    raise exception 'invalid_priority' using errcode = '22023';
  end if;
  if (select count(*) from public.support_tickets where restaurant_id = v_restaurant and status <> 'closed') >= 10 then
    raise exception 'too_many_open' using errcode = '53400';
  end if;

  insert into public.support_tickets (restaurant_id, created_by, subject, priority)
  values (v_restaurant, auth.uid(), v_subject, p_priority)
  returning id into v_id;
  insert into public.support_messages (ticket_id, restaurant_id, author_id, author_kind, body)
  values (v_id, v_restaurant, auth.uid(), 'merchant', v_body);
  return v_id;
end;
$$;

-- Responde a um chamado: admin da plataforma (author_kind platform) ou OWNER da loja dona (merchant).
create or replace function public.support_add_message(p_ticket uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ticket public.support_tickets;
  v_body text := btrim(coalesce(p_body, ''));
  v_kind text;
  v_id uuid;
begin
  select * into v_ticket from public.support_tickets where id = p_ticket for update;
  if not found then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_platform_admin() then
    v_kind := 'platform';
  elsif public.is_restaurant_owner(v_ticket.restaurant_id) then
    v_kind := 'merchant';
  else
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 4000 then
    raise exception 'invalid_body' using errcode = '22023';
  end if;
  if v_ticket.status = 'closed' then
    raise exception 'ticket_closed' using errcode = '55000';
  end if;
  if v_kind = 'merchant' and (
       select count(*) from public.support_messages
        where ticket_id = p_ticket and author_kind = 'merchant' and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'rate_limited' using errcode = '53400';
  end if;

  insert into public.support_messages (ticket_id, restaurant_id, author_id, author_kind, body)
  values (p_ticket, v_ticket.restaurant_id, auth.uid(), v_kind, v_body)
  returning id into v_id;

  update public.support_tickets
     set last_message_at = now(),
         updated_at = now(),
         -- plataforma respondeu => aguardando o lojista; lojista respondeu => volta para a fila da plataforma
         status = case when v_kind = 'platform' then 'waiting_customer' else 'open' end
   where id = p_ticket;
  return v_id;
end;
$$;

-- Muda o status. Plataforma: open/waiting_customer/resolved/closed. Lojista (OWNER): só encerra (closed).
create or replace function public.support_set_status(p_ticket uuid, p_status text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ticket public.support_tickets;
begin
  if p_status is null or p_status not in ('open', 'waiting_customer', 'resolved', 'closed') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  select * into v_ticket from public.support_tickets where id = p_ticket for update;
  if not found then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.is_platform_admin() then
    if not public.is_restaurant_owner(v_ticket.restaurant_id) or p_status <> 'closed' then
      raise exception 'not_authorized' using errcode = '42501';
    end if;
  end if;
  update public.support_tickets
     set status = p_status,
         closed_at = case when p_status = 'closed' then coalesce(closed_at, now()) else null end,
         updated_at = now()
   where id = p_ticket;
end;
$$;

-- Prioridade: só a plataforma.
create or replace function public.support_set_priority(p_ticket uuid, p_priority text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_priority is null or p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'invalid_priority' using errcode = '22023';
  end if;
  update public.support_tickets set priority = p_priority, updated_at = now() where id = p_ticket;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- Fila da plataforma: todos os chamados com o nome da loja. Só admin; os demais recebem erro.
create or replace function public.support_admin_list(p_status text default null, p_limit integer default 100)
returns table (
  id uuid,
  restaurant_id uuid,
  restaurant_name text,
  subject text,
  priority text,
  status text,
  created_at timestamptz,
  last_message_at timestamptz,
  messages_count bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
    select t.id, t.restaurant_id, r.name, t.subject, t.priority, t.status, t.created_at, t.last_message_at,
           (select count(*) from public.support_messages m where m.ticket_id = t.id)
      from public.support_tickets t
      join public.restaurants r on r.id = t.restaurant_id
     where p_status is null or t.status = p_status
     order by case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
              t.last_message_at desc
     limit least(greatest(coalesce(p_limit, 100), 1), 200);
end;
$$;

revoke all on function public.support_create_ticket(text, text, text) from public, anon;
revoke all on function public.support_add_message(uuid, text) from public, anon;
revoke all on function public.support_set_status(uuid, text) from public, anon;
revoke all on function public.support_set_priority(uuid, text) from public, anon;
revoke all on function public.support_admin_list(text, integer) from public, anon;
grant execute on function public.support_create_ticket(text, text, text) to authenticated;
grant execute on function public.support_add_message(uuid, text) to authenticated;
grant execute on function public.support_set_status(uuid, text) to authenticated;
grant execute on function public.support_set_priority(uuid, text) to authenticated;
grant execute on function public.support_admin_list(text, integer) to authenticated;

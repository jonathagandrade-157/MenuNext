-- MenuNext — trava contra assinatura duplicada. Sem isto, um dono que já
-- tem assinatura Asaas viva (active/pending/overdue) podia assinar de novo:
-- cobrança em dobro no Asaas e, pior, o status voltava para 'pending' (que
-- não bloqueia), destravando uma loja inadimplente sem pagar. Só quem não
-- tem assinatura ou está 'cancelled' pode iniciar uma nova.
--
-- Mesma assinatura da função (3 parâmetros) — create or replace troca o
-- corpo sem criar overload.

create or replace function public.start_restaurant_subscription(
  p_plan_id uuid,
  p_asaas_customer_id text,
  p_asaas_subscription_id text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_restaurant_id uuid;
  v_role text;
  v_current_subscription_id text;
  v_current_status text;
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

  if not exists (select 1 from public.plans where id = p_plan_id and is_active = true) then
    raise exception 'plan_not_found' using errcode = '22023';
  end if;

  if p_asaas_customer_id is null or trim(p_asaas_customer_id) = ''
     or p_asaas_subscription_id is null or trim(p_asaas_subscription_id) = '' then
    raise exception 'invalid_asaas_reference' using errcode = '22023';
  end if;

  select r.asaas_subscription_id, r.subscription_status
  into v_current_subscription_id, v_current_status
  from public.restaurants r
  where r.id = v_restaurant_id
  for update;

  if v_current_subscription_id is not null and v_current_status <> 'cancelled' then
    raise exception 'already_subscribed' using errcode = '55000';
  end if;

  update public.restaurants
  set plan_id = p_plan_id,
      asaas_customer_id = p_asaas_customer_id,
      asaas_subscription_id = p_asaas_subscription_id,
      subscription_status = 'pending'
  where id = v_restaurant_id;
end;
$$;

revoke all on function public.start_restaurant_subscription(uuid, text, text) from public, anon;
grant execute on function public.start_restaurant_subscription(uuid, text, text) to authenticated;

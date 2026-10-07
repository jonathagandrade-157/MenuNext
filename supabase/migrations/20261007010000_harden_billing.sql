-- MenuNext — endurecimento do billing (achados da auditoria de 2026-10-07).
--
-- 1) restaurants.plan_id era ON DELETE SET NULL: excluir um plano em uso
--    apagava o vínculo do restaurante enquanto a assinatura no Asaas seguia
--    cobrando. Passa a RESTRICT — plano em uso não pode ser excluído (o
--    master desativa em vez de excluir). Também ganha índice, que o FK
--    precisa tanto para o RESTRICT quanto para o advisor de performance.
-- 2) process_asaas_webhook é chamável pelo role anon (o Asaas não tem
--    sessão), então o token é a única defesa: exige 32–255 caracteres para
--    inviabilizar adivinhação por tentativas. Vazio continua limpando o
--    token (webhook fica desligado, fail-closed).

alter table public.restaurants
  drop constraint restaurants_plan_id_fkey,
  add constraint restaurants_plan_id_fkey
    foreign key (plan_id) references public.plans (id) on delete restrict;

create index restaurants_plan_id_idx on public.restaurants (plan_id);

create or replace function public.update_billing_settings(p_asaas_webhook_token text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_token text := nullif(trim(coalesce(p_asaas_webhook_token, '')), '');
begin
  if not public.is_platform_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if v_token is not null and length(v_token) not between 32 and 255 then
    raise exception 'invalid_token_length' using errcode = '22023';
  end if;

  update public.billing_settings
  set asaas_webhook_token = v_token
  where id = true;
end;
$$;

revoke all on function public.update_billing_settings(text) from public, anon;
grant execute on function public.update_billing_settings(text) to authenticated;

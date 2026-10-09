-- MenuNext — P0-01: proteger as colunas de assinatura/cobrança de restaurants.
--
-- CAUSA RAIZ
-- A migration 20261001020000 tentou proteger plan_id, subscription_status,
-- asaas_customer_id, asaas_subscription_id e subscription_current_period_end
-- com `REVOKE UPDATE (colunas) ... FROM authenticated`. Isso NÃO tem efeito:
-- authenticated já tinha UPDATE na tabela inteira (relacl:
-- authenticated=arwdDxtm/postgres, nenhuma ACL por coluna), e em Postgres o
-- privilégio de tabela e o de coluna se SOMAM; revogar só a coluna não tira o
-- que a tabela concede. A policy restaurants_update_members libera a linha
-- para qualquer membro (OWNER ou STAFF) e não tem WITH CHECK, então
-- `PATCH /rest/v1/restaurants` com plan_id/subscription_status passava.
--
-- O mesmo erro já tinha sido encontrado e corrigido para profiles
-- (20260910130254_restrict_profiles_update_columns.sql); este arquivo aplica
-- o padrão correto desta vez em restaurants: revogar UPDATE da TABELA INTEIRA
-- e conceder de volta SÓ as colunas operacionais.
--
-- O QUE ESTA MIGRATION FAZ
-- 1. Revoga UPDATE de restaurants para authenticated e anon.
-- 2. Concede UPDATE só nas 36 colunas operacionais que o app realmente edita
--    (levantadas nas Server Actions: onboarding, informações, delivery,
--    pagamentos, aparência, configurações, status da loja, logo/capa).
--    Ficam de fora: id, created_at, updated_at (o trigger set_updated_at as
--    preenche sem precisar de privilégio) e as 5 colunas de cobrança.
--    Coluna nova no futuro nasce SEM permissão de escrita (seguro por padrão).
-- 3. Segunda camada, independente de GRANT: trigger BEFORE UPDATE que recusa
--    mudança nas colunas de cobrança quando quem executa é anon/authenticated.
--    Se alguém reabrir o GRANT por engano, o trigger ainda barra. As RPCs
--    legítimas (start_restaurant_subscription, process_asaas_webhook) são
--    SECURITY DEFINER com dono postgres: dentro delas current_user é
--    'postgres', então o trigger não as afeta. Painel do Supabase e
--    service_role também não são afetados.
--
-- COMPATIBILIDADE
-- Nenhum código do app grava as colunas de cobrança por update direto (varredura
-- em src/: só leitura em subscription.ts); elas só são escritas pelas duas RPCs
-- acima. Colunas de trial (profiles.trial_*) já estão protegidas por
-- 20260910130254 (UPDATE só em name/phone) e não mudam aqui.
--
-- RECUPERAÇÃO: o procedimento detalhado é mantido em documentação privada do
-- projeto, fora deste repositório público. Se uma tela falhar com permission
-- denied numa coluna operacional, corrija para a frente concedendo só essa
-- coluna (grant update (coluna) on public.restaurants to authenticated); veja
-- docs/seguranca/restaurants-colunas-de-cobranca.md.

revoke update on public.restaurants from authenticated;
revoke update on public.restaurants from anon;

grant update (
  -- identidade e publicação
  name, slug, status, onboarding_completed, onboarding_step,
  -- endereço
  address_zip, address_street, address_number, address_complement,
  address_neighborhood, address_city, address_state,
  -- atendimento e entrega
  service_delivery, service_pickup, delivery_fee, delivery_radius_km,
  delivery_fee_method, minimum_order_value, free_delivery_threshold,
  estimated_delivery_min_minutes, estimated_delivery_max_minutes,
  latitude, longitude,
  -- formas de pagamento da loja (Pix direto, dinheiro, cartão na entrega)
  payment_pix, payment_pix_key, payment_pix_key_type, payment_pix_holder_name,
  payment_pix_city, payment_cash, payment_card,
  -- aparência e contato
  logo_path, cover_path, theme_primary_color,
  contact_whatsapp, contact_email, bio
) on public.restaurants to authenticated;

-- ============================================================
-- Segunda camada: guarda por trigger (independe de GRANT/RLS).
-- SECURITY INVOKER de propósito: precisa enxergar o current_user real de
-- quem executa o UPDATE (anon/authenticated via API vs. postgres dentro das
-- RPCs SECURITY DEFINER).
-- ============================================================
create or replace function public.guard_restaurant_billing_columns()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if current_user in ('anon', 'authenticated') and (
    new.plan_id is distinct from old.plan_id
    or new.subscription_status is distinct from old.subscription_status
    or new.asaas_customer_id is distinct from old.asaas_customer_id
    or new.asaas_subscription_id is distinct from old.asaas_subscription_id
    or new.subscription_current_period_end is distinct from old.subscription_current_period_end
  ) then
    raise exception 'billing_columns_protected' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists restaurants_guard_billing_columns on public.restaurants;
create trigger restaurants_guard_billing_columns
  before update on public.restaurants
  for each row execute function public.guard_restaurant_billing_columns();

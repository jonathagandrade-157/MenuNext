-- Fase 4.1 — expõe pedido mínimo e tempo estimado de entrega (adicionados em
-- add_delivery_config_and_cancellation.sql) na leitura pública da loja, para
-- a loja pública e o checkout poderem mostrá-los ao cliente. Mesma RPC
-- SECURITY DEFINER já usada (get_public_restaurant_by_slug) — só adiciona
-- colunas ao retorno, nenhuma outra regra muda. Postgres não permite
-- `create or replace` mudar o RETURNS TABLE de uma função existente, então
-- é preciso DROP + CREATE (e reconceder EXECUTE a anon/authenticated, que se
-- perde no DROP).
drop function public.get_public_restaurant_by_slug(text);

create function public.get_public_restaurant_by_slug(p_slug text)
returns table (
  id uuid,
  name text,
  slug text,
  status text,
  onboarding_completed boolean,
  logo_path text,
  cover_path text,
  service_delivery boolean,
  service_pickup boolean,
  delivery_fee numeric,
  delivery_radius_km numeric,
  minimum_order_value numeric,
  estimated_delivery_min_minutes integer,
  estimated_delivery_max_minutes integer,
  payment_pix boolean,
  payment_cash boolean,
  payment_card boolean
)
language sql
stable security definer
set search_path to 'public'
as $function$
  select r.id, r.name, r.slug, r.status, r.onboarding_completed, r.logo_path, r.cover_path,
         r.service_delivery, r.service_pickup, r.delivery_fee, r.delivery_radius_km,
         r.minimum_order_value, r.estimated_delivery_min_minutes, r.estimated_delivery_max_minutes,
         r.payment_pix, r.payment_cash, r.payment_card
  from public.restaurants r
  where r.slug = p_slug
    and r.onboarding_completed = true;
$function$;

revoke all on function public.get_public_restaurant_by_slug(text) from public;
grant execute on function public.get_public_restaurant_by_slug(text) to anon, authenticated;

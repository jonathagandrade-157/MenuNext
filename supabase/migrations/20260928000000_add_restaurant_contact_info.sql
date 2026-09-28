-- MenuNext — área "Configurações Gerais" do redesign do painel (referência
-- Stitch). Nome do restaurante e endereço JÁ são editáveis em
-- /painel/informacoes (não duplicados aqui) — o gap real desta tela é
-- contato (WhatsApp/e-mail) e uma bio curta, nenhum dos três existentes.
--
-- contact_whatsapp e bio são PÚBLICOS (aparecem na loja pública: bio no
-- lugar do subtítulo fixo "Cardápio digital" do StoreHeader, WhatsApp como
-- botão flutuante) — dado real que o próprio lojista cadastra, nunca
-- inventado. contact_email é só para uso interno (relatórios/faturamento,
-- como no mockup) e por isso NÃO entra em get_public_restaurant_by_slug.

alter table public.restaurants
  add column contact_whatsapp text,
  add column contact_email text,
  add column bio text;

alter table public.restaurants
  add constraint restaurants_bio_length_check check (bio is null or length(bio) <= 160);

-- ---------------------------------------------------------------------------
-- get_public_restaurant_by_slug — adiciona bio e contact_whatsapp (mesmo
-- padrão de DROP+CREATE já usado nas evoluções anteriores desta função,
-- ver add_distance_based_delivery_fee.sql: RETURNS TABLE não aceita
-- CREATE OR REPLACE quando a lista de colunas muda).
-- ---------------------------------------------------------------------------
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
  delivery_fee_method text,
  latitude numeric,
  longitude numeric,
  minimum_order_value numeric,
  estimated_delivery_min_minutes integer,
  estimated_delivery_max_minutes integer,
  payment_pix boolean,
  payment_cash boolean,
  payment_card boolean,
  bio text,
  contact_whatsapp text
)
language sql
stable security definer
set search_path to 'public'
as $function$
  select r.id, r.name, r.slug, r.status, r.onboarding_completed, r.logo_path, r.cover_path,
         r.service_delivery, r.service_pickup, r.delivery_fee, r.delivery_radius_km,
         r.delivery_fee_method, r.latitude, r.longitude,
         r.minimum_order_value, r.estimated_delivery_min_minutes, r.estimated_delivery_max_minutes,
         r.payment_pix, r.payment_cash, r.payment_card,
         r.bio, r.contact_whatsapp
  from public.restaurants r
  where r.slug = p_slug
    and r.onboarding_completed = true;
$function$;

revoke all on function public.get_public_restaurant_by_slug(text) from public;
grant execute on function public.get_public_restaurant_by_slug(text) to anon, authenticated;

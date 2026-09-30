-- MenuNext — área "Aparência da Loja" do redesign do painel (referência
-- Stitch). Escopo desta entrega, decidido pelo engenheiro sem bloquear no
-- usuário (mockup é um motor de tema completo — paleta sugerida por IA a
-- partir do logo, checagem WCAG automática, produtos em destaque, banner
-- promocional, toggles de rodapé, preview ao vivo mobile/desktop): só a
-- COR PRIMÁRIA da loja, a peça mais bem definida e de maior impacto visual
-- (usada em botões/CTAs/destaques em toda a loja pública), sem nenhuma das
-- partes especulativas/maiores. As demais ficam registradas no plano do
-- roadmap para decisão de escopo em sessão futura, não implementadas aqui.
--
-- --color-primary hoje é uma variável CSS GLOBAL (src/app/globals.css),
-- compartilhada pelo painel inteiro E pela loja pública — não pode ser
-- sobrescrita ali sem recolorir o painel de TODOS os restaurantes. A
-- aplicação real fica só na página da loja pública (/loja/[slug]), via
-- override inline de --color-primary num wrapper — nunca no arquivo CSS
-- global nem no painel.

alter table public.restaurants
  add column theme_primary_color text;

alter table public.restaurants
  add constraint restaurants_theme_primary_color_check
    check (theme_primary_color is null or theme_primary_color ~ '^#[0-9a-fA-F]{6}$');

-- ---------------------------------------------------------------------------
-- get_public_restaurant_by_slug — adiciona theme_primary_color (mesmo padrão
-- DROP+CREATE já usado nas evoluções anteriores desta função).
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
  contact_whatsapp text,
  theme_primary_color text
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
         r.bio, r.contact_whatsapp, r.theme_primary_color
  from public.restaurants r
  where r.slug = p_slug
    and r.onboarding_completed = true;
$function$;

revoke all on function public.get_public_restaurant_by_slug(text) from public;
grant execute on function public.get_public_restaurant_by_slug(text) to anon, authenticated;

-- MenuNext — promoções automáticas (v1): desconto em % ou R$ sobre o subtotal do pedido, aplicado sozinho
-- no checkout, na sacola e na Frente de Caixa quando as condições valem.
--
-- REGRAS DA v1 (decididas com o usuário)
--   * Condições: pedido mínimo, período (início/fim), dias da semana e janela de horário (sem virar a
--     meia-noite), sempre no fuso America/Sao_Paulo. Ligar/desligar a qualquer momento.
--   * Não acumula com cupom: vale o MAIOR desconto; empate fica com o cupom. O uso do cupom só é consumido
--     se o cupom vencer (uses_count deixa de subir quando a promoção vence).
--   * O desconto incide sobre o subtotal (nunca sobre a taxa de entrega), nunca passa do subtotal e entra
--     em orders.discount_amount — a constraint total = subtotal - desconto + entrega continua valendo.
--     Sem nenhuma promoção cadastrada, create_order grava exatamente o mesmo pedido de antes.
--   * Fora desta versão: desconto por item/categoria, "leve mais", combo com preço especial.
--
-- MUDANÇA EM create_order: esta migration NÃO carrega uma cópia da função (o texto versionado em migrations
-- antigas está defasado em relação à produção). Ela lê a definição que está no banco e troca 4 trechos, cada um
-- exigido EXATAMENTE uma vez (senão aborta sem mudar nada): 3 variáveis novas, o bloco que decide promoção x
-- cupom (e passa a fazer o update do uso do cupom DEPOIS dessa decisão) e as 2 colunas novas no insert de
-- orders. Mesma assinatura, mesmas permissões. Nenhum outro comportamento muda.

-- ============================================================
-- 1. promotions
-- ============================================================
create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null check (name = btrim(name) and char_length(name) between 2 and 60),
  discount_type text not null check (discount_type in ('percent', 'fixed')),
  discount_value numeric(10, 2) not null check (discount_value > 0),
  min_order_value numeric(10, 2) check (min_order_value is null or min_order_value >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  -- 0 = domingo ... 6 = sábado (igual a extract(dow)); null = todos os dias
  weekdays smallint[],
  time_from time,
  time_to time,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promotions_percent_range check (discount_type <> 'percent' or discount_value <= 100),
  constraint promotions_period_order check (starts_at is null or ends_at is null or ends_at > starts_at),
  constraint promotions_weekdays_valid check (
    weekdays is null
    or (cardinality(weekdays) between 1 and 7 and weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[])
  ),
  constraint promotions_time_window check (
    (time_from is null and time_to is null) or (time_from is not null and time_to is not null and time_from < time_to)
  )
);

create index promotions_restaurant_id_idx on public.promotions (restaurant_id);

create trigger set_updated_at before update on public.promotions
  for each row execute function public.set_updated_at();

alter table public.promotions enable row level security;

-- Privilégios enxutos (como restaurant_banners/product_costs): visitante sem acesso; membro só DML (a RLS decide quem).
revoke all on public.promotions from public, anon, authenticated;
grant select, insert, update, delete on public.promotions to authenticated;

-- Leitura para membros (o painel lista); escrita só do OWNER. O público nunca lê a tabela: usa preview_promotion.
create policy promotions_select_members on public.promotions
  for select to authenticated using (public.is_restaurant_member(restaurant_id));
create policy promotions_insert_owner on public.promotions
  for insert to authenticated with check (public.is_restaurant_owner(restaurant_id));
create policy promotions_update_owner on public.promotions
  for update to authenticated using (public.is_restaurant_owner(restaurant_id)) with check (public.is_restaurant_owner(restaurant_id));
create policy promotions_delete_owner on public.promotions
  for delete to authenticated using (public.is_restaurant_owner(restaurant_id));

-- ============================================================
-- 2. orders — qual promoção valeu (histórico). Excluir a promoção não apaga o pedido.
-- ============================================================
alter table public.orders
  add column promotion_id uuid references public.promotions (id) on delete set null,
  add column promotion_name text check (promotion_name is null or char_length(promotion_name) <= 60);

-- ============================================================
-- 3. _promotion_best — a melhor promoção válida AGORA para um subtotal (interna; create_order e
--    preview_promotion são os únicos chamadores). Empate no valor: a mais antiga.
-- ============================================================
create or replace function public._promotion_best(p_restaurant uuid, p_subtotal numeric, p_now timestamptz)
returns table (promotion_id uuid, name text, discount_amount numeric)
language sql
stable
security definer
set search_path to 'public'
as $$
  select x.id, x.name, x.amount
    from (
      select p.id, p.name, p.created_at,
             least(
               p_subtotal,
               case p.discount_type
                 when 'percent' then round(p_subtotal * p.discount_value / 100, 2)
                 else p.discount_value
               end
             ) as amount
        from public.promotions p
       where p.restaurant_id = p_restaurant
         and p.is_active
         and (p.starts_at is null or p.starts_at <= p_now)
         and (p.ends_at is null or p.ends_at > p_now)
         and (p.min_order_value is null or p_subtotal >= p.min_order_value)
         and (p.weekdays is null or extract(dow from (p_now at time zone 'America/Sao_Paulo'))::smallint = any (p.weekdays))
         and (
           p.time_from is null
           or ((p_now at time zone 'America/Sao_Paulo')::time >= p.time_from
               and (p_now at time zone 'America/Sao_Paulo')::time < p.time_to)
         )
    ) x
   where x.amount > 0
   order by x.amount desc, x.created_at, x.id
   limit 1;
$$;

revoke all on function public._promotion_best(uuid, numeric, timestamptz) from public, anon, authenticated;

-- ============================================================
-- 4. preview_promotion — leitura pública (anon + authenticated), sem efeito colateral. Mostra no checkout
--    "Promoção X: -R$ Y" antes de finalizar; create_order é a autoridade e recalcula tudo. Loja que não
--    está publicada (ou subtotal inválido) devolve vazio, nunca erro.
-- ============================================================
create or replace function public.preview_promotion(p_slug text, p_subtotal numeric)
returns table (promotion_id uuid, name text, discount_amount numeric)
language sql
stable
security definer
set search_path to 'public'
as $$
  select b.promotion_id, b.name, b.discount_amount
    from public.restaurants r
    cross join lateral public._promotion_best(r.id, p_subtotal, now()) b
   where r.slug = lower(trim(coalesce(p_slug, '')))
     and r.status = 'active'
     and r.onboarding_completed is true
     and p_subtotal is not null
     and p_subtotal >= 0;
$$;

revoke all on function public.preview_promotion(text, numeric) from public, anon;
grant execute on function public.preview_promotion(text, numeric) to anon, authenticated;

-- ============================================================
-- 5. create_order (ver o cabeçalho)
-- ============================================================
do $patch$
declare
  v_oid oid := 'public.create_order(text,text,text,text,text,jsonb,text,text,text,text,text,text,text,text,text,numeric,text,numeric,text)'::regprocedure;
  v_def text;
  v_from text[];
  v_to text[];
  v_n integer;
  v_f text;
  v_t text;
  i integer;
begin
  v_def := replace(pg_get_functiondef(v_oid), chr(13), '');

  v_from := array[
    $f1$  v_coupon_code_used text;
$f1$,
    $f2$
    update public.coupons set uses_count = uses_count + 1 where id = v_coupon.id;
  end if;
$f2$,
    $f3$coupon_id, coupon_code,
    discount_amount, total, status, idempotency_key
  )$f3$,
    $f4$v_coupon_id, v_coupon_code_used,
    v_discount_amount, v_total, 'received', v_idempotency_key
  )$f4$
  ];

  v_to := array[
    $t1$  v_coupon_code_used text;
  v_promo record;
  v_promotion_id uuid;
  v_promotion_name text;
$t1$,
    $t2$  end if;

  -- Promocao automatica: vale o MAIOR desconto entre ela e o cupom (nao acumulam). O uso do cupom so e
  -- consumido se ele for o vencedor; empate fica com o cupom. O lock "for update" do cupom segue valendo.
  select * into v_promo from public._promotion_best(v_restaurant.id, v_subtotal, v_now);
  if v_promo.promotion_id is not null and v_promo.discount_amount > v_discount_amount then
    v_discount_amount := v_promo.discount_amount;
    v_promotion_id := v_promo.promotion_id;
    v_promotion_name := v_promo.name;
    v_coupon_id := null;
    v_coupon_code_used := null;
  elsif v_coupon_id is not null then
    update public.coupons set uses_count = uses_count + 1 where id = v_coupon_id;
  end if;
$t2$,
    $t3$coupon_id, coupon_code,
    discount_amount, total, status, idempotency_key, promotion_id, promotion_name
  )$t3$,
    $t4$v_coupon_id, v_coupon_code_used,
    v_discount_amount, v_total, 'received', v_idempotency_key, v_promotion_id, v_promotion_name
  )$t4$
  ];

  for i in 1 .. array_length(v_from, 1) loop
    -- tira CR dos trechos: o arquivo pode ter sido baixado com CRLF; a definicao no banco so tem LF
    v_f := replace(v_from[i], chr(13), '');
    v_t := replace(v_to[i], chr(13), '');
    v_n := (length(v_def) - length(replace(v_def, v_f, ''))) / length(v_f);
    if v_n <> 1 then
      raise exception 'create_order mudou: trecho % aparece % vez(es) (esperado 1); nada foi alterado', i, v_n using errcode = '55000';
    end if;
    v_def := replace(v_def, v_f, v_t);
  end loop;

  execute v_def;
end
$patch$;

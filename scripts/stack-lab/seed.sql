-- Dados SINTÉTICOS do stack-lab (nenhum dado real). Ids iguais aos de users.json.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000a001', 'owner-a@stack.test', jsonb_build_object('name','Dona A','phone','11999990001','document','12345678062')),
  ('00000000-0000-4000-8000-00000000a002', 'staff-a@stack.test', jsonb_build_object('name','Equipe A','phone','11999990002','document','98765432029')),
  ('00000000-0000-4000-8000-00000000b001', 'owner-b@stack.test', jsonb_build_object('name','Dono B','phone','11999990003','document','24681357090'));
update public.profiles set trial_ends_at = now() + interval '30 days';

insert into public.restaurants (id, name, slug) values
  ('00000000-0000-4000-8000-0000000a0000', 'Pizzaria Lab', 'pizzaria-lab'),
  ('00000000-0000-4000-8000-0000000b0000', 'Outra Lab', 'outra-lab');
insert into public.restaurant_members (restaurant_id, user_id, role) values
  ('00000000-0000-4000-8000-0000000a0000', '00000000-0000-4000-8000-00000000a001', 'OWNER'),
  ('00000000-0000-4000-8000-0000000a0000', '00000000-0000-4000-8000-00000000a002', 'STAFF'),
  ('00000000-0000-4000-8000-0000000b0000', '00000000-0000-4000-8000-00000000b001', 'OWNER');
update public.restaurants set onboarding_completed = true, status = 'active', service_pickup = true, service_delivery = true,
       delivery_fee = 5, payment_cash = true,
       payment_pix = true, payment_pix_key = 'pix@stack.test', payment_pix_key_type = 'email';
delete from public.business_hours;
insert into public.business_hours (restaurant_id, day_of_week, opens_at, closes_at, period_order)
  select r.id, d, '00:00', '23:59:59', 1 from public.restaurants r cross join generate_series(0, 6) d;

insert into public.categories (id, restaurant_id, name, display_order) values
  ('00000000-0000-4000-8000-0000000ac001', '00000000-0000-4000-8000-0000000a0000', 'Pizzas', 1),
  ('00000000-0000-4000-8000-0000000bc001', '00000000-0000-4000-8000-0000000b0000', 'Pizzas', 1);
insert into public.products (id, restaurant_id, name, price, category_id, display_order) values
  ('00000000-0000-4000-8000-0000000a1001', '00000000-0000-4000-8000-0000000a0000', 'Pizza Calabresa', 40, '00000000-0000-4000-8000-0000000ac001', 1),
  ('00000000-0000-4000-8000-0000000a1002', '00000000-0000-4000-8000-0000000a0000', 'Suco de Laranja', 8, '00000000-0000-4000-8000-0000000ac001', 2),
  ('00000000-0000-4000-8000-0000000a1003', '00000000-0000-4000-8000-0000000a0000', 'Esfiha', 6, '00000000-0000-4000-8000-0000000ac001', 3),
  ('00000000-0000-4000-8000-0000000b1001', '00000000-0000-4000-8000-0000000b0000', 'Pizza B', 50, '00000000-0000-4000-8000-0000000bc001', 1);

-- variantes só existem se a migration do cadastro estiver aplicada (cenários de banco "antigo" pulam)
do $$
begin
  if to_regclass('public.product_variants') is not null then
    insert into public.product_variants (id, product_id, restaurant_id, name, price, is_available, display_order) values
      ('00000000-0000-4000-8000-0000000a2001', '00000000-0000-4000-8000-0000000a1001', '00000000-0000-4000-8000-0000000a0000', 'Pequena', 35, true, 1),
      ('00000000-0000-4000-8000-0000000a2002', '00000000-0000-4000-8000-0000000a1001', '00000000-0000-4000-8000-0000000a0000', 'Media', 55.5, true, 2),
      ('00000000-0000-4000-8000-0000000a2003', '00000000-0000-4000-8000-0000000a1001', '00000000-0000-4000-8000-0000000a0000', 'Grande', 70, false, 3),
      ('00000000-0000-4000-8000-0000000b2001', '00000000-0000-4000-8000-0000000b1001', '00000000-0000-4000-8000-0000000b0000', 'Unica', 1, true, 1);
  end if;
end $$;

-- caixa aberto na loja A (PDV)
insert into public.cash_sessions (restaurant_id, opened_by, opening_amount)
  values ('00000000-0000-4000-8000-0000000a0000', '00000000-0000-4000-8000-00000000a002', 100);

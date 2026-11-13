-- SOMENTE em banco descartavel. Dados sinteticos exigidos por supabase/tests/tenant_isolation.sql
-- (2 lojas, uma com OWNER nao-master, e 1 master fora da loja A). Aplicado pelo runner imediatamente antes da suite.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner-a@seed.test', jsonb_build_object('name','Owner A','phone','11999990011','document','52998224725')),
  ('00000000-0000-4000-8000-0000000000b1', 'owner-b@seed.test', jsonb_build_object('name','Owner B','phone','11999990012','document','39053344705')),
  ('00000000-0000-4000-8000-0000000000c1', 'master@seed.test',  jsonb_build_object('name','Master','phone','11999990013','document','12345678909'));
update public.profiles set is_master = true where user_id = '00000000-0000-4000-8000-0000000000c1';
update public.profiles set trial_ends_at = now() + interval '30 days' where user_id in ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000b1');
with a as (insert into public.restaurants (name, slug) values ('Seed Loja A', 'seed-loja-a') returning id),
     b as (insert into public.restaurants (name, slug) values ('Seed Loja B', 'seed-loja-b') returning id)
insert into public.restaurant_members (restaurant_id, user_id, role)
  select a.id, '00000000-0000-4000-8000-0000000000a1'::uuid, 'OWNER' from a
  union all select b.id, '00000000-0000-4000-8000-0000000000b1'::uuid, 'OWNER' from b;

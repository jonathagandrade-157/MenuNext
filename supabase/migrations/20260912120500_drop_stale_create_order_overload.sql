-- A migration anterior (add_distance_based_delivery_fee.sql) usou
-- `create or replace function create_order(...)` adicionando um novo
-- parâmetro (p_delivery_distance_km) ao final da lista. Postgres identifica
-- uma função por nome + tipos de parâmetros — adicionar um parâmetro cria
-- uma SEGUNDA função (overload) em vez de substituir a antiga, então a
-- versão de 16 argumentos (sem nenhuma validação de raio/distância) ficou
-- viva e continuava chamável por anon. Corrigido removendo o overload
-- antigo — só a versão de 17 argumentos (com p_delivery_distance_km) deve
-- existir.
drop function if exists public.create_order(
  text, text, text, text, text, jsonb, text, text, text, text, text, text, text, text, text, numeric, text
);

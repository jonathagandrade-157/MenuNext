-- MenuNext — área "Pagamentos" do redesign do painel (referência Stitch).
--
-- Campos exigidos pelo padrão EMV do BR Code Pix (Manual de Padrões para
-- Iniciação do Pix, Banco Central) para montar o QR/"copia e cola": nome do
-- recebedor (campo 59) e cidade (campo 60) são obrigatórios no payload,
-- então precisam existir como dado real — nunca inventados a partir de
-- `restaurants.name` (que pode ter emoji/símbolo/tamanho fora do aceito
-- pelo EMV, que só permite Latin básico até 25/15 caracteres).
--
-- `payment_pix_key_type` é só metadado de UX (ajuda o lojista a saber que
-- tipo de chave cadastrou e valida o formato certo na tela) — o BR Code em
-- si não depende do tipo, só do valor da chave.

alter table public.restaurants
  add column payment_pix_key_type text,
  add column payment_pix_holder_name text,
  add column payment_pix_city text;

alter table public.restaurants
  add constraint restaurants_payment_pix_key_type_check
    check (payment_pix_key_type is null or payment_pix_key_type in ('cpf_cnpj', 'email', 'telefone', 'aleatoria'));

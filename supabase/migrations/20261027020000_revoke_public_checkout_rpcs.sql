-- MenuNext — checkout público: passo 2 de 2.
--
-- ORDEM DE IMPLANTAÇÃO (diferente do habitual): primeiro o passo 1 (20261027010000), depois o app novo no ar, e SÓ
-- ENTÃO esta migration. O app antigo chama estas funções com a chave pública; assim que o EXECUTE é revogado ele
-- deixa de conseguir fechar pedido, validar cupom, ver promoção e cadastrar conta.
--
-- Estas quatro funções passam a ser executáveis apenas pelo servidor do app (service_role), onde ficam os limites
-- de tentativas e a verificação da origem. Visitantes e usuários logados não as chamam mais direto pela API.
--   create_order, validate_coupon, preview_promotion, is_document_eligible
-- A venda de balcão continua com a sessão do membro, via create_counter_order (passo 1).

revoke all on function public.create_order(
  text, text, text, text, text, jsonb, text, text, text, text, text, text, text, text, text, numeric, text, numeric, text
) from public, anon, authenticated;
grant execute on function public.create_order(
  text, text, text, text, text, jsonb, text, text, text, text, text, text, text, text, text, numeric, text, numeric, text
) to service_role;

revoke all on function public.validate_coupon(text, text, numeric) from public, anon, authenticated;
grant execute on function public.validate_coupon(text, text, numeric) to service_role;

revoke all on function public.preview_promotion(text, numeric) from public, anon, authenticated;
grant execute on function public.preview_promotion(text, numeric) to service_role;

revoke all on function public.is_document_eligible(text) from public, anon, authenticated;
grant execute on function public.is_document_eligible(text) to service_role;

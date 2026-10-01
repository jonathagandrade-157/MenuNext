/**
 * Mapeamento de códigos de erro da RPC create_order (SECURITY DEFINER) para
 * mensagens amigáveis — compartilhado entre submitOrderAction (checkout
 * público, sempre anônimo) e createCounterOrderAction (Frente de Caixa,
 * sempre autenticado). Não pode viver num arquivo "use server" porque não é
 * uma função async (Next.js exige que toda exportação de um arquivo "use
 * server" seja uma Server Action).
 */
export function friendlyOrderError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("not_authenticated") || normalized.includes("not_authorized")) {
    return "Você não tem permissão para registrar vendas de balcão. Faça login novamente.";
  }
  if (normalized.includes("restaurant_not_found")) return "Esta loja não está disponível no momento.";
  if (normalized.includes("restaurant_unavailable")) {
    return "Esta loja está pausada ou fechada no momento e não está aceitando pedidos.";
  }
  if (normalized.includes("restaurant_closed")) return "Esta loja está fora do horário de funcionamento no momento.";
  if (normalized.includes("invalid_name")) return "Informe seu nome.";
  if (normalized.includes("invalid_phone")) return "Informe um telefone válido, com DDD.";
  if (normalized.includes("invalid_fulfillment_type")) return "Selecione entrega ou retirada.";
  if (normalized.includes("delivery_not_available")) return "Esta loja não oferece entrega no momento.";
  if (normalized.includes("pickup_not_available")) return "Esta loja não oferece retirada no momento.";
  if (normalized.includes("invalid_address")) return "Preencha o endereço de entrega completo.";
  if (normalized.includes("invalid_payment_method")) return "Selecione uma forma de pagamento válida.";
  if (normalized.includes("invalid_change")) return "O valor para troco deve ser maior ou igual ao total do pedido.";
  if (normalized.includes("below_minimum_order")) return "O valor do seu pedido está abaixo do pedido mínimo desta loja.";
  if (normalized.includes("address_out_of_range")) return "Não entregamos neste endereço — está fora da área de entrega.";
  if (normalized.includes("invalid_distance")) return "Não foi possível calcular a distância de entrega para este endereço.";
  if (normalized.includes("empty_cart")) return "Sua sacola está vazia.";
  if (normalized.includes("invalid_quantity")) return "Quantidade inválida em algum item da sacola.";
  if (normalized.includes("observation_too_long")) return "A observação é muito longa.";
  if (normalized.includes("product_not_found")) {
    return "Um dos produtos da sua sacola não está mais disponível nesta loja. Revise a sacola.";
  }
  if (normalized.includes("product_unavailable")) {
    return "Um dos produtos da sua sacola ficou indisponível. Revise a sacola.";
  }
  if (normalized.includes("addon_not_linked_to_product") || normalized.includes("addon_not_found")) {
    return "Um dos adicionais escolhidos não é mais válido. Revise a sacola.";
  }
  if (normalized.includes("addon_unavailable")) {
    return "Um dos adicionais escolhidos ficou indisponível. Revise a sacola.";
  }
  if (normalized.includes("addon_group_inactive")) {
    return "Um grupo de adicionais escolhido não está mais disponível. Revise a sacola.";
  }
  if (normalized.includes("addon_group_selection_invalid")) {
    return "A seleção de adicionais de algum item da sacola não é mais válida. Revise a sacola.";
  }
  if (normalized.includes("coupon_not_found")) return "Cupom não encontrado. Remova-o para continuar.";
  if (normalized.includes("coupon_inactive")) return "Este cupom não está mais ativo. Remova-o para continuar.";
  if (normalized.includes("coupon_expired")) return "Este cupom expirou. Remova-o para continuar.";
  if (normalized.includes("coupon_usage_limit_reached")) {
    return "Este cupom atingiu o limite de usos. Remova-o para continuar.";
  }
  if (normalized.includes("coupon_below_minimum_order")) {
    return "Seu pedido não atinge mais o mínimo exigido pelo cupom. Remova-o ou adicione mais itens.";
  }
  return "Não foi possível finalizar o pedido. Seus itens continuam na sacola. Tente novamente.";
}

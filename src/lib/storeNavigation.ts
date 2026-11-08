/**
 * "Voltar" e "Adicionar à sacola" na loja pública: só usam o histórico do navegador quando o cliente já navegou
 * DENTRO da loja nesta aba. Quem abriu o produto por um link (WhatsApp, Instagram, aba nova) não tem página
 * anterior da loja — router.back() levaria para fora do site (ou para uma página em branco). Nesse caso, vai
 * para o cardápio da loja.
 */
export const storeNavigationKey = (slug: string) => `menunext-nav-${slug}`;

export function shouldUseHistoryBack(input: { navigatedInStore: boolean; historyLength: number }): boolean {
  return input.navigatedInStore && input.historyLength > 1;
}

export function readNavigatedInStore(slug: string): boolean {
  try {
    return window.sessionStorage.getItem(storeNavigationKey(slug)) === "1";
  } catch {
    return false; // sessionStorage indisponível (modo privado restrito): cai no cardápio, nunca para fora
  }
}

export function markNavigatedInStore(slug: string): void {
  try {
    window.sessionStorage.setItem(storeNavigationKey(slug), "1");
  } catch {
    // sem sessionStorage: o "voltar" vai para o cardápio, que é seguro
  }
}

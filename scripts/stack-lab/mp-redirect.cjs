// SOMENTE no stack-lab: carregado com `node --require` no processo do `next start` de TESTE. Redireciona as chamadas
// do servidor para https://api.mercadopago.com ao simulador local (fake-mercadopago.mjs), sem mudar o código do app
// (que, em produção, nunca aceita outro endereço para o Mercado Pago). Não use fora do laboratório.
const target = process.env.STACK_LAB_MP_URL;
if (target) {
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://api.mercadopago.com/")) return original(target + url.slice("https://api.mercadopago.com".length), init);
    return original(input, init);
  };
}

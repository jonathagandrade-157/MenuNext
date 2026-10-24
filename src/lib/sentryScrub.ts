/**
 * Remove de um evento do Sentry os cabeçalhos e cookies que carregam credenciais
 * (token do webhook do Asaas, Authorization, chaves de API). Se uma exceção não
 * tratada acontecer numa rota de cobrança, o Sentry anexaria a requisição ao
 * evento; este filtro garante que o segredo não saia do servidor.
 */
const SENSITIVE_HEADERS = new Set([
  "asaas-access-token",
  "access_token",
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "apikey",
  "x-api-key",
]);

type RequestLike = { headers?: Record<string, unknown>; cookies?: unknown };

/** Aceita qualquer evento com `request` (o tipo do Sentry varia por versão) e o devolve igual, já limpo. */
export function scrubSensitiveRequestData<T extends { request?: unknown }>(event: T): T {
  const request = event.request as RequestLike | undefined;
  if (!request) return event;
  if (request.headers) {
    for (const name of Object.keys(request.headers)) {
      if (SENSITIVE_HEADERS.has(name.toLowerCase())) request.headers[name] = "[removido]";
    }
  }
  if (request.cookies) request.cookies = "[removido]";
  return event;
}

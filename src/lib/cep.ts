/**
 * Busca automática de endereço por CEP (Sprint 3) — só para FACILITAR o
 * preenchimento do checkout. Nunca é a fonte de verdade do pedido: o
 * endereço final continua sendo o que estiver nos campos (editáveis) no
 * momento do envio, e o servidor (create_order) continua validando tudo de
 * novo, independente do que a busca por CEP preencheu.
 *
 * ViaCEP é uma API pública brasileira, sem chave (diferente do geocoding em
 * src/lib/geocoding.ts, que precisa de credencial e roda só no servidor) —
 * por isso a consulta acontece direto no navegador, sem precisar de uma
 * Server Action nem de nenhum segredo novo.
 */

/** Mantém só os dígitos, limitado a 8, formatados como 00000-000 enquanto o
 * cliente digita. Nunca lança — entrada inválida vira string mais curta. */
export function formatCepInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

export function cepDigits(cep: string): string {
  return cep.replace(/\D/g, "");
}

export function isCompleteCep(cep: string): boolean {
  return cepDigits(cep).length === 8;
}

export type CepAddress = {
  street: string;
  neighborhood: string;
  city: string;
  state: string;
};

export type CepLookupResult =
  | { ok: true; address: CepAddress }
  | { ok: false; reason: "invalid" | "not_found" | "request_failed" };

/** Consulta a ViaCEP — só chamada quando isCompleteCep(cep) é verdadeiro
 * (nunca a cada tecla). `erro: true` no corpo é como a ViaCEP sinaliza CEP
 * inexistente (não é um HTTP de erro). */
export async function lookupCep(cep: string): Promise<CepLookupResult> {
  const digits = cepDigits(cep);
  if (digits.length !== 8) return { ok: false, reason: "invalid" };

  let response: Response;
  try {
    response = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
  } catch {
    return { ok: false, reason: "request_failed" };
  }

  if (!response.ok) return { ok: false, reason: "request_failed" };

  let body: { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "request_failed" };
  }

  if (body.erro) return { ok: false, reason: "not_found" };

  return {
    ok: true,
    address: {
      street: body.logradouro ?? "",
      neighborhood: body.bairro ?? "",
      city: body.localidade ?? "",
      state: body.uf ?? "",
    },
  };
}

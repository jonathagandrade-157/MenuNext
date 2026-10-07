/**
 * Cliente da API do Asaas (gateway de cobrança da ASSINATURA do lojista no
 * MenuNext — nunca confundir com o Pix direto do checkout dos clientes
 * finais, que não usa gateway nenhum). Só roda no servidor: a chave
 * (`ASAAS_API_KEY`) nunca tem prefixo NEXT_PUBLIC_, então o bundler nunca a
 * inclui no JavaScript enviado ao navegador.
 *
 * Se a variável não estiver configurada, as funções aqui nunca inventam uma
 * resposta nem fingem sucesso — retornam `{ ok: false, reason:
 * "not_configured" }` e quem chamar decide o que mostrar (mesmo padrão de
 * isGeocodingConfigured/geocodeAddress em src/lib/geocoding.ts).
 *
 * `ASAAS_ENV` controla sandbox (padrão, mais seguro para um recurso que
 * ainda não foi validado contra a API real) vs produção — só "production"
 * usa a API real de cobrança.
 */

export type AsaasResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "not_configured" | "request_failed" | "invalid_response"; message?: string };

export function isAsaasConfigured(): boolean {
  return Boolean(process.env.ASAAS_API_KEY);
}

function getBaseUrl(): string {
  return process.env.ASAAS_ENV === "production" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
}

async function asaasRequest<T>(path: string, init: RequestInit): Promise<AsaasResult<T>> {
  const apiKey = process.env.ASAAS_API_KEY;
  if (!apiKey) return { ok: false, reason: "not_configured" };

  let response: Response;
  try {
    response = await fetch(`${getBaseUrl()}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        access_token: apiKey,
        ...init.headers,
      },
    });
  } catch {
    return { ok: false, reason: "request_failed" };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "invalid_response" };
  }

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "errors" in body
        ? JSON.stringify((body as { errors: unknown }).errors)
        : `HTTP ${response.status}`;
    return { ok: false, reason: "request_failed", message };
  }

  return { ok: true, data: body as T };
}

export type AsaasCustomer = { id: string };

/** Cria (ou, se o CPF/CNPJ já existir no Asaas, o Asaas retorna o mesmo
 * customer existente — comportamento nativo da API deles) o cliente de
 * cobrança para o dono do restaurante. */
export async function createAsaasCustomer(params: {
  name: string;
  email: string;
  cpfCnpj: string;
}): Promise<AsaasResult<AsaasCustomer>> {
  return asaasRequest<AsaasCustomer>("/customers", {
    method: "POST",
    body: JSON.stringify({
      name: params.name,
      email: params.email,
      cpfCnpj: params.cpfCnpj.replace(/\D/g, ""),
    }),
  });
}

/** Remove uma assinatura no Asaas — usado só para desfazer uma assinatura
 * recém-criada quando não foi possível registrá-la no banco, evitando uma
 * assinatura órfã que continuaria cobrando o lojista. */
export async function deleteAsaasSubscription(subscriptionId: string): Promise<AsaasResult<{ deleted: boolean }>> {
  return asaasRequest<{ deleted: boolean }>(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: "DELETE",
  });
}

export type AsaasSubscription = { id: string; status: string; nextDueDate: string };

/** Assinatura mensal recorrente — billingType "UNDEFINED" deixa o próprio
 * lojista escolher Pix/boleto/cartão a cada ciclo na página de pagamento
 * que o Asaas hospeda, em vez de travar um método só. */
export async function createAsaasSubscription(params: {
  customerId: string;
  value: number;
  description: string;
}): Promise<AsaasResult<AsaasSubscription>> {
  const nextDueDate = new Date();
  nextDueDate.setDate(nextDueDate.getDate() + 1);

  return asaasRequest<AsaasSubscription>("/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      customer: params.customerId,
      billingType: "UNDEFINED",
      value: params.value,
      cycle: "MONTHLY",
      nextDueDate: nextDueDate.toISOString().slice(0, 10),
      description: params.description,
    }),
  });
}

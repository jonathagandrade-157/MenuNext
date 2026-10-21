/**
 * Cliente da API do Mercado Pago para a ASSINATURA do lojista (provedor
 * alternativo ao Asaas — o Master escolhe qual usar). Só roda no servidor: o
 * token (`MERCADOPAGO_ACCESS_TOKEN`) nunca tem prefixo NEXT_PUBLIC_.
 *
 * Mesma regra do cliente do Asaas: sem a variável configurada, nada é inventado
 * nem simulado — retorna `{ ok: false, reason: "not_configured" }`.
 *
 * O Mercado Pago não tem host de sandbox separado: o ambiente de teste é
 * definido pelas credenciais (token de usuário de teste). Por isso não existe
 * chave ASAAS_ENV equivalente. Para ensaios locais com o simulador aceita
 * `MERCADOPAGO_BASE_URL`, mas SOMENTE para este mesmo computador (loopback) e
 * fora de produção: o token nunca é enviado a outro endereço por essa variável.
 *
 * Estado: escrito a partir da documentação oficial; os formatos exatos de
 * resposta e de status devem ser conferidos no sandbox real antes de ativar
 * cobrança (ver docs/mercadopago-sandbox.md).
 */

export type MercadoPagoResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      reason: "not_configured" | "request_failed" | "invalid_response";
      message?: string;
      /** Status HTTP da resposta, quando houve (404 = não existe; 5xx = tentar de novo). */
      httpStatus?: number;
    };

const PRODUCTION_BASE_URL = "https://api.mercadopago.com";
const REQUEST_TIMEOUT_MS = 10_000;

export function isMercadoPagoConfigured(): boolean {
  return Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN);
}

export function resolveMercadoPagoBaseUrl(env: { MERCADOPAGO_BASE_URL?: string; NODE_ENV?: string }): string {
  const override = env.MERCADOPAGO_BASE_URL;
  if (override && env.NODE_ENV !== "production") {
    try {
      const url = new URL(override);
      const isLoopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
      if (url.protocol === "http:" && isLoopback && !url.username && !url.password) {
        return override.replace(/\/+$/, "");
      }
    } catch {
      // URL inválida: ignora o override
    }
  }
  return PRODUCTION_BASE_URL;
}

async function mpRequest<T>(path: string, init: RequestInit): Promise<MercadoPagoResult<T>> {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) return { ok: false, reason: "not_configured" };

  let response: Response;
  try {
    response = await fetch(
      `${resolveMercadoPagoBaseUrl({ MERCADOPAGO_BASE_URL: process.env.MERCADOPAGO_BASE_URL, NODE_ENV: process.env.NODE_ENV })}${path}`,
      {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...init.headers,
        },
      }
    );
  } catch {
    return { ok: false, reason: "request_failed" };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "invalid_response", httpStatus: response.status };
  }

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body && typeof (body as { message: unknown }).message === "string"
        ? (body as { message: string }).message.slice(0, 300)
        : `HTTP ${response.status}`;
    return { ok: false, reason: "request_failed", message, httpStatus: response.status };
  }

  return { ok: true, data: body as T };
}

// ---------------------------------------------------------------------------
// Tipos (só os campos de que o MenuNext depende; o resto é ignorado).
// ---------------------------------------------------------------------------

/** pending = aguardando o pagador autorizar; authorized = ativa; paused/cancelled = inativa. */
export type MercadoPagoPreapproval = {
  id: string;
  status: string;
  external_reference?: string | null;
  payer_id?: number | string | null;
  init_point?: string | null;
  next_payment_date?: string | null;
  auto_recurring?: {
    frequency?: number;
    frequency_type?: string;
    transaction_amount?: number | string;
    currency_id?: string;
  } | null;
};

export type MercadoPagoAuthorizedPayment = {
  id: number | string;
  preapproval_id: string;
  status: string;
  transaction_amount?: number | string;
  debit_date?: string | null;
  external_reference?: string | null;
  payment?: { id?: number | string; status?: string; status_detail?: string } | null;
};

export type MercadoPagoSearch<T> = { results: T[]; paging?: { total?: number; limit?: number; offset?: number } };

// ---------------------------------------------------------------------------
// Chamadas
// ---------------------------------------------------------------------------

/**
 * Assinatura mensal SEM plano associado e com pagamento pendente: o lojista é
 * mandado ao `init_point` (checkout hospedado pelo Mercado Pago), onde escolhe
 * o meio de pagamento e autoriza. Nenhum acesso é liberado aqui.
 */
export function createMercadoPagoPreapproval(params: {
  payerEmail: string;
  amount: number;
  reason: string;
  /** ID da assinatura no banco do MenuNext (billing_subscriptions.id). */
  externalReference: string;
  backUrl: string;
}): Promise<MercadoPagoResult<MercadoPagoPreapproval>> {
  return mpRequest<MercadoPagoPreapproval>("/preapproval", {
    method: "POST",
    body: JSON.stringify({
      reason: params.reason,
      external_reference: params.externalReference,
      payer_email: params.payerEmail,
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: params.amount,
        currency_id: "BRL",
      },
      back_url: params.backUrl,
      status: "pending",
    }),
  });
}

export function getMercadoPagoPreapproval(id: string): Promise<MercadoPagoResult<MercadoPagoPreapproval>> {
  return mpRequest<MercadoPagoPreapproval>(`/preapproval/${encodeURIComponent(id)}`, { method: "GET" });
}

/** Cancela a assinatura — usado para desfazer uma assinatura recém-criada que não pôde ser registrada. */
export function cancelMercadoPagoPreapproval(id: string): Promise<MercadoPagoResult<MercadoPagoPreapproval>> {
  return mpRequest<MercadoPagoPreapproval>(`/preapproval/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ status: "cancelled" }),
  });
}

export function searchMercadoPagoPreapprovalsByExternalReference(
  externalReference: string
): Promise<MercadoPagoResult<MercadoPagoSearch<MercadoPagoPreapproval>>> {
  return mpRequest<MercadoPagoSearch<MercadoPagoPreapproval>>(
    `/preapproval/search?external_reference=${encodeURIComponent(externalReference)}`,
    { method: "GET" }
  );
}

export function getMercadoPagoAuthorizedPayment(id: string): Promise<MercadoPagoResult<MercadoPagoAuthorizedPayment>> {
  return mpRequest<MercadoPagoAuthorizedPayment>(`/authorized_payments/${encodeURIComponent(id)}`, { method: "GET" });
}

export function listMercadoPagoAuthorizedPayments(
  preapprovalId: string,
  offset: number,
  limit: number
): Promise<MercadoPagoResult<MercadoPagoSearch<MercadoPagoAuthorizedPayment>>> {
  return mpRequest<MercadoPagoSearch<MercadoPagoAuthorizedPayment>>(
    `/authorized_payments/search?preapproval_id=${encodeURIComponent(preapprovalId)}&offset=${offset}&limit=${limit}`,
    { method: "GET" }
  );
}

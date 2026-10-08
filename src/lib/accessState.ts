/** Motivo pelo qual o acesso ao painel e à loja pública de um restaurante
 * está bloqueado. Vem da função do banco `_restaurant_access_state`
 * (null = liberado) — a regra vive no banco para valer igual no painel, na
 * loja pública e no `create_order`. */
export type AccessState = "overdue" | "cancelled" | "trial_expired";

const ACCESS_STATES: readonly AccessState[] = ["overdue", "cancelled", "trial_expired"];

/** Valor desconhecido vira null (liberado) em vez de bloquear por engano:
 * o bloqueio real sempre é reforçado no banco (create_order). */
export function parseAccessState(raw: unknown): AccessState | null {
  return ACCESS_STATES.find((state) => state === raw) ?? null;
}

export const ACCESS_STATE_COPY: Record<AccessState, { badge: string; message: string }> = {
  overdue: {
    badge: "Pagamento atrasado",
    message: "Há um pagamento em atraso. Regularize para voltar a usar o painel e a loja pública.",
  },
  cancelled: {
    badge: "Assinatura cancelada",
    message: "Sua assinatura foi cancelada. Assine um plano para voltar a usar o painel e a loja pública.",
  },
  trial_expired: {
    badge: "Teste encerrado",
    message: "Seu período de teste de 30 dias terminou. Assine um plano para voltar a usar o painel e a loja pública.",
  },
};

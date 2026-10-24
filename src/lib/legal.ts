/**
 * Dados do responsável pelos textos legais (/privacidade e /termos).
 *
 * ATENÇÃO — completar antes de abrir para clientes reais: o CNPJ, o endereço e
 * o encarregado (DPO) dependem de dados da empresa que o código não conhece.
 * Enquanto estiverem null, a página simplesmente não mostra a linha, em vez de
 * exibir um dado inventado. O e-mail de contato vem da variável de ambiente
 * NEXT_PUBLIC_LEGAL_CONTACT_EMAIL (mesma regra: sem valor, sem linha).
 */
export const LEGAL_ENTITY = {
  name: "MenuNext Tecnologia para Gastronomia Ltda.",
  cnpj: null as string | null,
  address: null as string | null,
  dpoName: null as string | null,
} as const;

export const LEGAL_CONTACT_EMAIL: string | null = process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL?.trim() || null;

/** Versão dos textos — atualizar sempre que o conteúdo mudar de forma relevante. */
export const LEGAL_LAST_UPDATED = "21 de outubro de 2026";

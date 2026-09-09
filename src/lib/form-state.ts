// Constantes e tipos compartilhados por Server Actions e os formulários
// client-side que as chamam. Não pode viver dentro de um arquivo "use server"
// (esses só podem exportar funções async), por isso fica separado.

export type StepActionState = { status: "idle" | "error"; message?: string };
export const initialStepState: StepActionState = { status: "idle" };

export type AuthActionState = {
  status: "idle" | "error" | "confirm_email";
  message?: string;
};
export const initialAuthState: AuthActionState = { status: "idle" };

export const WEEK_DAYS = [
  { value: 0, label: "Domingo" },
  { value: 1, label: "Segunda" },
  { value: 2, label: "Terça" },
  { value: 3, label: "Quarta" },
  { value: 4, label: "Quinta" },
  { value: 5, label: "Sexta" },
  { value: 6, label: "Sábado" },
] as const;

// Constantes e tipos compartilhados por Server Actions e os formulários
// client-side que as chamam. Não pode viver dentro de um arquivo "use server"
// (esses só podem exportar funções async), por isso fica separado.

export type StepActionState = { status: "idle" | "error"; message?: string };
export const initialStepState: StepActionState = { status: "idle" };

export type AuthActionState = {
  status: "idle" | "error";
  message?: string;
};
export const initialAuthState: AuthActionState = { status: "idle" };

// Diferente de StepActionState: aqui precisamos distinguir "sucesso" do
// estado inicial "idle" (o formulário fica na mesma página, num modal, em
// vez de navegar para o próximo passo — não dá pra usar "voltou pra idle"
// como sinal de sucesso).
export type CategoryActionState = { status: "idle" | "success" | "error"; message?: string };
export const initialCategoryState: CategoryActionState = { status: "idle" };

// Mesmo formato de CategoryActionState — mantido separado (não compartilhado)
// porque produto e categoria evoluem por sprints diferentes e podem divergir.
export type ProductActionState = { status: "idle" | "success" | "error"; message?: string };
export const initialProductState: ProductActionState = { status: "idle" };

// Mesmo formato de CategoryActionState/ProductActionState — grupos e itens
// de adicionais evoluem juntos (mesma tela), então compartilham um único
// tipo de estado de formulário.
export type AddonActionState = { status: "idle" | "success" | "error"; message?: string };
export const initialAddonState: AddonActionState = { status: "idle" };

// Mesmo formato de CategoryActionState/ProductActionState/AddonActionState.
export type ComboActionState = { status: "idle" | "success" | "error"; message?: string };
export const initialComboState: ComboActionState = { status: "idle" };

export const WEEK_DAYS = [
  { value: 0, label: "Domingo" },
  { value: 1, label: "Segunda" },
  { value: 2, label: "Terça" },
  { value: 3, label: "Quarta" },
  { value: 4, label: "Quinta" },
  { value: 5, label: "Sexta" },
  { value: 6, label: "Sábado" },
] as const;

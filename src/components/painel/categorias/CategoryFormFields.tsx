"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/States";
import { initialCategoryState, type CategoryActionState } from "@/lib/form-state";
import type { Category } from "@/lib/tenant";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" loading={pending} disabled={pending}>
      {pending ? "Salvando..." : label}
    </Button>
  );
}

/** Formulário de Nova/Editar categoria — mesmo corpo para os dois casos. */
export function CategoryFormFields({
  action,
  category,
  submitLabel,
  onSuccess,
}: {
  action: (prev: CategoryActionState, formData: FormData) => Promise<CategoryActionState>;
  category?: Category;
  submitLabel: string;
  onSuccess: () => void;
}) {
  const [state, formAction] = useActionState(action, initialCategoryState);

  useEffect(() => {
    if (state.status === "success") onSuccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  return (
    <form action={formAction} className="space-y-4">
      {category && <input type="hidden" name="categoryId" value={category.id} />}

      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-graphite">Nome *</span>
        <input
          name="name"
          type="text"
          required
          maxLength={80}
          defaultValue={category?.name}
          placeholder="Ex.: Hambúrgueres"
          className="h-11 w-full rounded-lg border border-border bg-surface-card px-3 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-graphite">Descrição</span>
        <textarea
          name="description"
          maxLength={200}
          rows={2}
          defaultValue={category?.description ?? ""}
          placeholder="Ex.: Artesanais, smash burgers e especiais"
          className="w-full rounded-lg border border-border bg-surface-card px-3 py-2 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
        />
      </label>

      {state.status === "error" && <ErrorState message={state.message ?? "Não foi possível salvar."} />}

      <SubmitButton label={submitLabel} />
    </form>
  );
}

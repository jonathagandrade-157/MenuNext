"use client";

import { useActionState, useEffect, useState } from "react";
import { savePasso7Action, skipOnboardingStepAction } from "@/lib/actions/onboarding";
import { initialStepState } from "@/lib/form-state";
import { FieldLabel, inputClass, ErrorMessage, StepNavigation } from "@/components/onboarding/OnboardingShell";
import type { Category } from "@/lib/tenant";

const skipStep7 = skipOnboardingStepAction.bind(null, 7);

export function Passo7Form({ categories }: { categories: Category[] }) {
  const [state, formAction] = useActionState(savePasso7Action, initialStepState);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (preview) URL.revokeObjectURL(preview);
    const file = e.target.files?.[0];
    setPreview(file ? URL.createObjectURL(file) : null);
  }

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <FieldLabel>Foto do produto (opcional)</FieldLabel>
        <input
          type="file"
          name="image"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleImageChange}
          className="block w-full text-sm text-text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary hover:file:bg-primary/20"
        />
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Prévia do produto" className="mt-3 h-20 w-20 rounded-lg border border-border object-cover" />
        )}
        <p className="mt-1.5 text-xs text-text-muted">
          Você pode adicionar até 5 fotos depois, no painel.
        </p>
      </div>

      <div>
        <FieldLabel>Nome do produto *</FieldLabel>
        <input name="name" type="text" required maxLength={120} placeholder="Ex.: X-Bacon Artesanal" className={inputClass} />
      </div>

      <div>
        <FieldLabel>Descrição</FieldLabel>
        <textarea
          name="description"
          rows={3}
          maxLength={500}
          placeholder="Pão brioche, blend 180g, cheddar duplo, bacon crocante."
          className="w-full rounded-lg border border-border bg-surface-card px-3 py-2 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
        />
      </div>

      <div>
        <FieldLabel>Preço (R$) *</FieldLabel>
        <input name="price" type="text" inputMode="decimal" required placeholder="28,90" className={inputClass} />
      </div>

      {categories.length > 0 ? (
        <div>
          <FieldLabel>Categoria *</FieldLabel>
          <select name="categoryId" required defaultValue="" className={inputClass}>
            <option value="" disabled>
              Selecione uma categoria
            </option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="rounded-lg bg-surface-subdued px-4 py-3 text-xs text-text-muted">
          Você ainda não tem categorias — vamos criar uma categoria padrão (&ldquo;Cardápio&rdquo;) para este produto.
          Você pode organizar melhor depois, no painel.
        </p>
      )}

      <ErrorMessage message={state.status === "error" ? state.message : undefined} />

      <StepNavigation backHref="/onboarding/passo-6" skipAction={skipStep7} submitLabel="Cadastrar produto" />
    </form>
  );
}

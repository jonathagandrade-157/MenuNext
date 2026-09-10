"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { checkSlugAvailability, savePasso1Action } from "@/lib/actions/onboarding";
import { initialStepState } from "@/lib/form-state";
import { FieldLabel, inputClass, ErrorMessage } from "@/components/onboarding/OnboardingShell";
import { SubmitButton } from "@/components/onboarding/SubmitButton";

function normalizePreview(input: string) {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function Passo1Form({ suggestedName = "" }: { suggestedName?: string }) {
  const [state, formAction] = useActionState(savePasso1Action, initialStepState);
  const [slug, setSlug] = useState(() => normalizePreview(suggestedName));
  const [slugStatus, setSlugStatus] = useState<"idle" | "checking" | "available" | "taken">(() =>
    normalizePreview(suggestedName).length >= 3 ? "checking" : "idle"
  );
  const [, startTransition] = useTransition();

  function handleSlugChange(value: string) {
    const normalized = normalizePreview(value);
    setSlug(normalized);
    setSlugStatus(normalized.length < 3 ? "idle" : "checking");

    startTransition(async () => {
      if (normalized.length < 3) return;
      const result = await checkSlugAvailability(normalized);
      setSlugStatus(result.available ? "available" : "taken");
    });
  }

  // Se o slug já veio pré-preenchido (nome da loja informado no cadastro),
  // confere a disponibilidade dele assim que o formulário monta.
  useEffect(() => {
    if (slug.length < 3) return;
    startTransition(async () => {
      const result = await checkSlugAvailability(slug);
      setSlugStatus(result.available ? "available" : "taken");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <FieldLabel>Nome do restaurante *</FieldLabel>
        <input
          name="name"
          type="text"
          required
          defaultValue={suggestedName}
          placeholder="Ex.: Next Burger Artesanal"
          className={inputClass}
          onChange={(e) => {
            if (!slug) handleSlugChange(e.target.value);
          }}
        />
      </div>

      <div>
        <FieldLabel>Endereço da sua loja online *</FieldLabel>
        <div className="flex items-center rounded-lg border border-border bg-surface-card focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/15">
          <span className="pl-3 text-sm text-text-muted">menunext.com.br/</span>
          <input
            name="slug"
            type="text"
            required
            minLength={3}
            value={slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            placeholder="seurestaurante"
            className="h-11 flex-1 rounded-r-lg bg-transparent px-1 text-sm text-graphite placeholder:text-slate-400 focus:outline-none"
          />
        </div>
        {slugStatus === "checking" && <p className="mt-1.5 text-xs text-text-muted">Verificando disponibilidade...</p>}
        {slugStatus === "available" && (
          <p className="mt-1.5 text-xs font-semibold text-emerald">✓ Endereço disponível para uso imediato!</p>
        )}
        {slugStatus === "taken" && <p className="mt-1.5 text-xs font-semibold text-red">Esse endereço já está em uso.</p>}
        {slugStatus === "idle" && (
          <p className="mt-1.5 text-xs text-text-muted">
            Use apenas letras minúsculas, números e hífens.
          </p>
        )}
      </div>

      <ErrorMessage message={state.status === "error" ? state.message : undefined} />

      <SubmitButton label="Salvar e continuar" />
    </form>
  );
}

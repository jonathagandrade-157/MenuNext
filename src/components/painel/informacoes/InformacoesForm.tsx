"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { saveInformacoesAction, initialInformacoesState } from "@/lib/actions/informacoes";
import { checkSlugAvailability } from "@/lib/actions/onboarding";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { Restaurant } from "@/lib/tenant";

const inputClass =
  "h-11 w-full rounded-lg border border-border bg-surface-card px-3 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15";

const fieldLabelClass = "mb-1.5 block text-sm font-semibold text-graphite";

function normalizePreview(input: string) {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full sm:w-auto" loading={pending} disabled={pending}>
      {pending ? "Salvando..." : "Salvar alterações"}
    </Button>
  );
}

/**
 * Edição de nome/slug/endereço do restaurante (separação onboarding/painel)
 * — mesmos campos e mesma verificação de disponibilidade de URL do Passo 1
 * (checkSlugAvailability, já exportada de lib/actions/onboarding.ts e
 * reaproveitada aqui sem duplicar lógica), mas com a ação de salvar
 * permanecendo em /painel/informacoes, nunca avançando para o onboarding.
 */
export function InformacoesForm({ restaurant }: { restaurant: Restaurant }) {
  const [state, formAction] = useActionState(saveInformacoesAction, initialInformacoesState);
  const [slug, setSlug] = useState(restaurant.slug);
  const [slugStatus, setSlugStatus] = useState<"idle" | "checking" | "available" | "taken" | "current">("current");
  const [, startTransition] = useTransition();

  function handleSlugChange(value: string) {
    const normalized = normalizePreview(value);
    setSlug(normalized);

    if (normalized === restaurant.slug) {
      setSlugStatus("current");
      return;
    }
    if (normalized.length < 3) {
      setSlugStatus("idle");
      return;
    }

    setSlugStatus("checking");
    startTransition(async () => {
      const result = await checkSlugAvailability(normalized);
      if (result.slug !== normalizePreview(value)) return; // resposta de uma digitação anterior
      setSlugStatus(result.available ? "available" : "taken");
    });
  }

  return (
    <form action={formAction} className="space-y-6">
      <Card className="space-y-5 p-6">
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-text-muted">Restaurante</h2>

        <div>
          <span className={fieldLabelClass}>Nome do restaurante *</span>
          <input name="name" type="text" required defaultValue={restaurant.name} className={inputClass} />
        </div>

        <div>
          <span className={fieldLabelClass}>Endereço da sua loja online *</span>
          <div className="flex items-center rounded-lg border border-border bg-surface-card focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/15">
            <span className="pl-3 text-sm text-text-muted">menunext.com.br/</span>
            <input
              name="slug"
              type="text"
              required
              minLength={3}
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              className="h-11 flex-1 rounded-r-lg bg-transparent px-1 text-sm text-graphite focus:outline-none"
            />
          </div>
          {slugStatus === "current" && <p className="mt-1.5 text-xs text-text-muted">Esta é a URL atual da sua loja.</p>}
          {slugStatus === "checking" && <p className="mt-1.5 text-xs text-text-muted">Verificando disponibilidade...</p>}
          {slugStatus === "available" && (
            <p className="mt-1.5 text-xs font-semibold text-emerald">✓ Endereço disponível para uso imediato!</p>
          )}
          {slugStatus === "taken" && <p className="mt-1.5 text-xs font-semibold text-red">Esse endereço já está em uso.</p>}
          {slugStatus === "idle" && (
            <p className="mt-1.5 text-xs text-text-muted">Use apenas letras minúsculas, números e hífens.</p>
          )}
        </div>
      </Card>

      <Card className="space-y-5 p-6">
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-text-muted">Endereço</h2>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <span className={fieldLabelClass}>CEP *</span>
            <input name="zip" required defaultValue={restaurant.address_zip ?? ""} className={inputClass} />
          </div>
          <div>
            <span className={fieldLabelClass}>Estado *</span>
            <input
              name="state"
              required
              maxLength={2}
              placeholder="SP"
              defaultValue={restaurant.address_state ?? ""}
              className={`${inputClass} uppercase`}
            />
          </div>
        </div>

        <div>
          <span className={fieldLabelClass}>Rua *</span>
          <input name="street" required defaultValue={restaurant.address_street ?? ""} className={inputClass} />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <span className={fieldLabelClass}>Número</span>
            <input name="number" defaultValue={restaurant.address_number ?? ""} className={inputClass} />
          </div>
          <div>
            <span className={fieldLabelClass}>Complemento</span>
            <input name="complement" defaultValue={restaurant.address_complement ?? ""} className={inputClass} />
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <span className={fieldLabelClass}>Bairro</span>
            <input name="neighborhood" defaultValue={restaurant.address_neighborhood ?? ""} className={inputClass} />
          </div>
          <div>
            <span className={fieldLabelClass}>Cidade *</span>
            <input name="city" required defaultValue={restaurant.address_city ?? ""} className={inputClass} />
          </div>
        </div>
      </Card>

      {state.status === "error" && (
        <div className="rounded-lg border border-[#FEF2F2] bg-[#FEF2F2] px-3 py-2 text-sm font-medium text-red">
          {state.message}
        </div>
      )}
      {state.status === "success" && (
        <div className="rounded-lg border border-[#ECFDF5] bg-[#ECFDF5] px-3 py-2 text-sm font-medium text-emerald">
          Informações salvas com sucesso.
        </div>
      )}

      <SaveButton />
    </form>
  );
}

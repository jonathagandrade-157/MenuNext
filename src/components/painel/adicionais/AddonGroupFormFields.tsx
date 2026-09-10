"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/States";
import { initialAddonState, type AddonActionState } from "@/lib/form-state";
import type { AddonGroup } from "@/lib/tenant";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" loading={pending} disabled={pending}>
      {pending ? "Salvando..." : label}
    </Button>
  );
}

const inputClass =
  "h-11 w-full rounded-lg border border-border bg-surface-card px-3 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15";

/** Formulário de Novo/Editar grupo de adicionais — mesmo corpo para os dois casos. */
export function AddonGroupFormFields({
  action,
  group,
  submitLabel,
  onSuccess,
}: {
  action: (prev: AddonActionState, formData: FormData) => Promise<AddonActionState>;
  group?: AddonGroup;
  submitLabel: string;
  onSuccess: () => void;
}) {
  const [state, formAction] = useActionState(action, initialAddonState);

  useEffect(() => {
    if (state.status === "success") onSuccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  return (
    <form action={formAction} className="space-y-4">
      {group && <input type="hidden" name="groupId" value={group.id} />}

      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-graphite">Nome *</span>
        <input
          name="name"
          type="text"
          required
          maxLength={80}
          defaultValue={group?.name}
          placeholder="Ex.: Borda recheada"
          className={inputClass}
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-graphite">Descrição</span>
        <textarea
          name="description"
          maxLength={200}
          rows={2}
          defaultValue={group?.description ?? ""}
          placeholder="Ex.: Escolha o recheio da borda da sua pizza"
          className="w-full rounded-lg border border-border bg-surface-card px-3 py-2 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
        />
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-graphite">Mínimo de seleções</span>
          <input
            name="minSelections"
            type="number"
            min={0}
            max={20}
            required
            defaultValue={group?.min_selections ?? 0}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-graphite">Máximo de seleções *</span>
          <input
            name="maxSelections"
            type="number"
            min={1}
            max={20}
            required
            defaultValue={group?.max_selections ?? 1}
            className={inputClass}
          />
        </label>
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="isRequired"
          defaultChecked={group?.is_required ?? false}
          className="h-4 w-4 rounded border-border"
        />
        <span className="text-sm font-semibold text-graphite">Obrigatório (cliente precisa escolher ao menos uma opção)</span>
      </label>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={group?.is_active ?? true}
          className="h-4 w-4 rounded border-border"
        />
        <span className="text-sm font-semibold text-graphite">Ativo</span>
      </label>

      {state.status === "error" && <ErrorState message={state.message ?? "Não foi possível salvar."} />}

      <SubmitButton label={submitLabel} />
    </form>
  );
}

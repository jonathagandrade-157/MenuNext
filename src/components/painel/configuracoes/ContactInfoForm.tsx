"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { saveContactInfoAction } from "@/lib/actions/configuracoes";
import { initialContactInfoState } from "@/lib/form-state";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { Restaurant } from "@/lib/tenant";

const inputClass =
  "h-11 w-full rounded-lg border border-border bg-surface-card px-3 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15";

const fieldLabelClass = "mb-1.5 block text-sm font-semibold text-graphite";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} disabled={pending}>
      {pending ? "Salvando..." : "Salvar dados do restaurante"}
    </Button>
  );
}

/**
 * Contato (WhatsApp/e-mail) e bio curta (área "Configurações Gerais" do
 * redesign) — nome e endereço já são editáveis em /painel/informacoes, não
 * duplicados aqui. bio e WhatsApp são reais na loja pública (StoreHeader e
 * botão flutuante de WhatsApp), não só cadastro morto.
 */
export function ContactInfoForm({ restaurant }: { restaurant: Restaurant }) {
  const [state, formAction] = useActionState(saveContactInfoAction, initialContactInfoState);

  return (
    <Card className="p-6">
      <h2 className="text-sm font-extrabold uppercase tracking-wide text-text-muted">Contato e divulgação</h2>
      <p className="mt-1 text-sm text-text-muted">
        WhatsApp e bio aparecem na sua loja pública. O e-mail é só para uso interno.
      </p>

      <form action={formAction} className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className={fieldLabelClass}>WhatsApp de contato ao cliente</span>
            <input
              name="contact_whatsapp"
              type="text"
              inputMode="numeric"
              defaultValue={restaurant.contact_whatsapp ?? ""}
              placeholder="11987654321 (DDD + número)"
              className={inputClass}
            />
          </div>
          <div>
            <span className={fieldLabelClass}>E-mail de contato</span>
            <input
              name="contact_email"
              type="email"
              defaultValue={restaurant.contact_email ?? ""}
              placeholder="contato@seurestaurante.com"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-text-muted">Para recebimento de relatórios e faturamento — não aparece na loja pública.</p>
          </div>
        </div>

        <div>
          <span className={fieldLabelClass}>Descrição curta da loja (bio)</span>
          <textarea
            name="bio"
            maxLength={160}
            rows={2}
            defaultValue={restaurant.bio ?? ""}
            placeholder="Hambúrgueres artesanais grelhados no fogo, entregues com agilidade."
            className={`${inputClass} h-auto resize-none py-2.5`}
          />
          <p className="mt-1 text-xs text-text-muted">Aparece no topo do seu cardápio público, no lugar de &ldquo;Cardápio digital&rdquo;.</p>
        </div>

        {state.status === "error" && <p className="text-xs font-semibold text-red">{state.message}</p>}
        {state.status === "success" && <p className="text-xs font-semibold text-emerald">Salvo com sucesso!</p>}

        <SaveButton />
      </form>
    </Card>
  );
}

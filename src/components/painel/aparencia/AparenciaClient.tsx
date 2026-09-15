"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { uploadCoverAction, uploadLogoAction } from "@/lib/actions/aparencia";
import { initialAparenciaState } from "@/lib/form-state";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} disabled={pending}>
      {pending ? "Enviando..." : label}
    </Button>
  );
}

function ImageUploadCard({
  title,
  description,
  fieldName,
  currentUrl,
  action,
  aspectClass,
}: {
  title: string;
  description: string;
  fieldName: string;
  currentUrl: string | null;
  action: (prev: { status: "idle" | "success" | "error"; message?: string }, formData: FormData) => Promise<{ status: "idle" | "success" | "error"; message?: string }>;
  aspectClass: string;
}) {
  const [state, formAction] = useActionState(action, initialAparenciaState);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const displayUrl = preview ?? currentUrl;

  return (
    <Card className="p-5">
      <h2 className="text-sm font-bold text-graphite">{title}</h2>
      <p className="mt-0.5 text-xs text-text-muted">{description}</p>

      <form action={formAction} className="mt-4 space-y-3">
        <div className={`w-full overflow-hidden rounded-xl bg-surface-subdued ${aspectClass}`}>
          {displayUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={displayUrl} alt={title} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-text-muted">Nenhuma imagem enviada</div>
          )}
        </div>

        <input
          type="file"
          name={fieldName}
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => {
            if (preview) URL.revokeObjectURL(preview);
            const file = e.target.files?.[0];
            setPreview(file ? URL.createObjectURL(file) : null);
          }}
          className="block w-full text-sm text-text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary hover:file:bg-primary/20"
        />

        {state.status === "error" && <p className="text-xs font-semibold text-red">{state.message}</p>}
        {state.status === "success" && <p className="text-xs font-semibold text-emerald">Salvo com sucesso!</p>}

        <SubmitButton label="Salvar" />
      </form>
    </Card>
  );
}

export function AparenciaClient({ logoUrl, coverUrl }: { logoUrl: string | null; coverUrl: string | null }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <ImageUploadCard
        title="Logo"
        description="Aparece no cabeçalho da sua loja e na área do lojista."
        fieldName="logo"
        currentUrl={logoUrl}
        action={uploadLogoAction}
        aspectClass="aspect-square max-w-40"
      />
      <ImageUploadCard
        title="Capa"
        description="Imagem de destaque no topo da sua loja pública."
        fieldName="cover"
        currentUrl={coverUrl}
        action={uploadCoverAction}
        aspectClass="aspect-[3/1]"
      />
    </div>
  );
}

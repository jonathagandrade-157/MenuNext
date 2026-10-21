"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { CircleCheck, RotateCcw, TriangleAlert } from "lucide-react";
import { saveThemeColorAction, uploadCoverAction, uploadLogoAction } from "@/lib/actions/aparencia";
import { initialAparenciaState, initialThemeColorState } from "@/lib/form-state";
import { buttonContrast, dominantColors, isHexColor } from "@/lib/colorContrast";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

const DEFAULT_PRIMARY_COLOR = "#ab2f00";

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} disabled={pending}>
      {pending ? "Enviando..." : label}
    </Button>
  );
}

/** Cores sugeridas a partir do logo (lidas no navegador; nada é enviado a lugar nenhum). */
function LogoPalette({ logoSrc, onPick }: { logoSrc: string | null; onPick: (hex: string) => void }) {
  const [palette, setPalette] = useState<string[]>([]);

  useEffect(() => {
    if (!logoSrc) return;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const size = 64;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, size, size);
        const colors = dominantColors(ctx.getImageData(0, 0, size, size).data, 5);
        if (!cancelled) setPalette(colors);
      } catch {
        // imagem sem permissão de leitura (CORS): simplesmente não sugere
        if (!cancelled) setPalette([]);
      }
    };
    img.onerror = () => {
      if (!cancelled) setPalette([]);
    };
    img.src = logoSrc;
    return () => {
      cancelled = true;
    };
  }, [logoSrc]);

  if (!logoSrc || palette.length === 0) return null;

  return (
    <div>
      <p className="text-label-md text-text-muted">Cores do seu logo</p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {palette.map((hex) => (
          <button
            key={hex}
            type="button"
            onClick={() => onPick(hex)}
            title={`Usar ${hex}`}
            aria-label={`Usar a cor ${hex}`}
            className="flex items-center gap-2 rounded-xl border border-border bg-surface-card px-2.5 py-1.5 text-label-md text-graphite hover:bg-surface-subdued"
          >
            <span className="h-5 w-5 rounded-md border border-border" style={{ backgroundColor: hex }} />
            {hex}
          </button>
        ))}
      </div>
    </div>
  );
}

function ContrastNotice({ color }: { color: string }) {
  if (!isHexColor(color)) return null;
  const { ratio, level } = buttonContrast(color);
  const ratioText = `${ratio.toFixed(1).replace(".", ",")}:1`;

  if (level === "AAA" || level === "AA") {
    return (
      <p className="flex items-start gap-2 rounded-xl bg-emerald/10 px-3 py-2 text-body-sm text-emerald">
        <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Boa leitura: o texto branco dos botões tem contraste {ratioText}.
      </p>
    );
  }
  return (
    <p className="flex items-start gap-2 rounded-xl bg-amber/10 px-3 py-2 text-body-sm text-amber-strong">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      {level === "AA-large"
        ? `Leitura limitada (${ratioText}): o texto branco dos botões fica difícil de ler. Prefira uma cor mais escura.`
        : `Contraste baixo (${ratioText}): o texto branco dos botões fica quase ilegível. Escolha uma cor mais escura.`}
    </p>
  );
}

function ThemeColorCard({
  color,
  onColorChange,
  logoSrc,
}: {
  color: string;
  onColorChange: (color: string) => void;
  logoSrc: string | null;
}) {
  const [state, formAction] = useActionState(saveThemeColorAction, initialThemeColorState);

  return (
    <Card className="p-5 sm:col-span-2">
      <h2 className="text-body-lg font-bold text-graphite">Cor de destaque</h2>
      <p className="mt-0.5 text-body-sm text-text-muted">
        Usada em botões e destaques na sua loja pública. Não afeta o painel.
      </p>

      <form action={formAction} className="mt-4 space-y-3">
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={isHexColor(color) ? color : DEFAULT_PRIMARY_COLOR}
            onChange={(e) => onColorChange(e.target.value)}
            aria-label="Escolher cor"
            className="h-11 w-14 shrink-0 cursor-pointer rounded-xl border border-border bg-surface-card p-1"
          />
          <input
            name="theme_primary_color"
            type="text"
            value={color}
            onChange={(e) => onColorChange(e.target.value)}
            placeholder={DEFAULT_PRIMARY_COLOR}
            className="h-11 flex-1 rounded-xl border border-border bg-surface-card px-3 text-body-md text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
          />
          <button
            type="button"
            onClick={() => onColorChange(DEFAULT_PRIMARY_COLOR)}
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-border bg-surface-card px-3 text-label-md text-graphite hover:bg-surface-subdued"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Restaurar padrão</span>
          </button>
        </div>

        <LogoPalette logoSrc={logoSrc} onPick={onColorChange} />
        <ContrastNotice color={color} />

        {state.status === "error" && <p className="text-label-md text-red">{state.message}</p>}
        {state.status === "success" && <p className="text-label-md text-emerald">Salvo com sucesso!</p>}

        <SubmitButton label="Salvar cor" />
      </form>
    </Card>
  );
}

function ImageUploadCard({
  title,
  description,
  fieldName,
  currentUrl,
  action,
  aspectClass,
  onPreviewChange,
}: {
  title: string;
  description: string;
  fieldName: string;
  currentUrl: string | null;
  action: (prev: { status: "idle" | "success" | "error"; message?: string }, formData: FormData) => Promise<{ status: "idle" | "success" | "error"; message?: string }>;
  aspectClass: string;
  onPreviewChange: (url: string | null) => void;
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
      <h2 className="text-body-lg font-bold text-graphite">{title}</h2>
      <p className="mt-0.5 text-body-sm text-text-muted">{description}</p>

      <form action={formAction} className="mt-4 space-y-3">
        <div className={`w-full overflow-hidden rounded-xl bg-surface-subdued ${aspectClass}`}>
          {displayUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={displayUrl} alt={title} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-body-sm text-text-muted">Nenhuma imagem enviada</div>
          )}
        </div>

        <input
          type="file"
          name={fieldName}
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => {
            if (preview) URL.revokeObjectURL(preview);
            const file = e.target.files?.[0];
            const url = file ? URL.createObjectURL(file) : null;
            setPreview(url);
            onPreviewChange(url);
          }}
          className="block w-full text-body-md text-text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:text-body-md file:font-semibold file:text-primary hover:file:bg-primary/20"
        />

        {state.status === "error" && <p className="text-label-md text-red">{state.message}</p>}
        {state.status === "success" && <p className="text-label-md text-emerald">Salvo com sucesso!</p>}

        <SubmitButton label="Salvar" />
      </form>
    </Card>
  );
}

/** Prévia da loja pública com a cor, o logo e a capa que estão na tela (ainda sem salvar). */
function StorePreview({
  storeName,
  logoUrl,
  coverUrl,
  color,
}: {
  storeName: string;
  logoUrl: string | null;
  coverUrl: string | null;
  color: string;
}) {
  const safeColor = isHexColor(color) ? color : DEFAULT_PRIMARY_COLOR;
  const themeStyle = {
    "--color-primary": safeColor,
    "--color-primary-container": `color-mix(in srgb, ${safeColor} 82%, white)`,
  } as React.CSSProperties;

  return (
    <div>
      <p className="mb-2 text-label-sm uppercase text-text-muted">Prévia da loja</p>
      <div style={themeStyle} className="mx-auto w-full max-w-[300px] overflow-hidden rounded-[28px] border-4 border-graphite bg-surface-card shadow-card">
        <div className="relative h-24 bg-graphite">
          {coverUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverUrl} alt="" className="h-full w-full object-cover" />
          )}
          <span className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-label-sm text-emerald">Aberto agora</span>
        </div>
        <div className="px-3 pb-4">
          <div className="-mt-7 h-14 w-14 rounded-xl border-2 border-white bg-white p-0.5 shadow-md">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="h-full w-full rounded-lg object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center rounded-lg bg-primary text-body-md font-extrabold text-white">
                {getInitials(storeName)}
              </div>
            )}
          </div>
          <p className="mt-2 text-body-lg font-bold text-graphite">{storeName}</p>
          <div className="mt-3 flex gap-1.5">
            <span className="rounded-lg bg-primary px-3 py-1 text-label-md text-white">Categoria</span>
            <span className="rounded-lg border border-border px-3 py-1 text-label-md text-graphite">Outra</span>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-border p-2.5">
            <div className="min-w-0">
              <p className="text-label-md text-graphite">Seu produto aqui</p>
              <p className="text-label-md text-primary">R$ 0,00</p>
            </div>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-body-md text-white">+</span>
          </div>
          <div className="mt-3 flex h-9 items-center justify-center rounded-xl bg-primary text-label-md text-white">Ver sacola</div>
        </div>
      </div>
      <p className="mt-2 text-center text-body-sm text-text-muted">Exemplo ilustrativo com a cor e as imagens desta tela.</p>
    </div>
  );
}

export function AparenciaClient({
  storeName,
  logoUrl,
  coverUrl,
  themePrimaryColor,
}: {
  storeName: string;
  logoUrl: string | null;
  coverUrl: string | null;
  themePrimaryColor: string | null;
}) {
  const [color, setColor] = useState(themePrimaryColor ?? DEFAULT_PRIMARY_COLOR);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);

  const shownLogo = logoPreview ?? logoUrl;
  const shownCover = coverPreview ?? coverUrl;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <div className="grid gap-4 sm:grid-cols-2">
        <ImageUploadCard
          title="Logo"
          description="Aparece no cabeçalho da sua loja e na área do lojista."
          fieldName="logo"
          currentUrl={logoUrl}
          action={uploadLogoAction}
          aspectClass="aspect-square max-w-40"
          onPreviewChange={setLogoPreview}
        />
        <ImageUploadCard
          title="Capa"
          description="Imagem de destaque no topo da sua loja pública."
          fieldName="cover"
          currentUrl={coverUrl}
          action={uploadCoverAction}
          aspectClass="aspect-[3/1]"
          onPreviewChange={setCoverPreview}
        />
        <ThemeColorCard color={color} onColorChange={setColor} logoSrc={shownLogo} />
      </div>

      <div className="lg:sticky lg:top-6">
        <StorePreview storeName={storeName} logoUrl={shownLogo} coverUrl={shownCover} color={color} />
      </div>
    </div>
  );
}

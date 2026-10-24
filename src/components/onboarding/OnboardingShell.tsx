import Link from "next/link";
import { SubmitButton } from "@/components/onboarding/SubmitButton";

const STEP_LABELS = [
  "Restaurante",
  "Endereço",
  "Atendimento",
  "Delivery",
  "Horários",
  "Pagamentos",
  "1º Produto",
] as const;

export function OnboardingShell({
  step,
  title,
  description,
  successMessage,
  children,
}: {
  step: number;
  title: string;
  description: string;
  successMessage?: string;
  children: React.ReactNode;
}) {
  const percent = Math.round((step / 7) * 100);

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-surface-card">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="text-body-lg font-extrabold text-graphite">
            Menu<span className="text-primary">Next</span>
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-body-sm font-semibold text-text-muted">Etapa {step} de 7</span>
            {/* O onboarding nunca é uma barreira: o lojista pode entrar no
                painel a qualquer momento e completar a configuração depois,
                pelo checklist. */}
            <Link href="/painel" className="text-body-sm font-semibold text-primary hover:underline">
              Ir para o painel
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        {successMessage && <SuccessMessage message={successMessage} />}

        <div className="mb-8">
          <div className="mb-2 flex items-baseline justify-between gap-3 text-body-sm font-semibold text-text-muted">
            <span>
              Etapa {step}: <span className="text-graphite">{STEP_LABELS[step - 1]}</span>
            </span>
            <span>{percent}% concluído</span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={7}
            aria-valuenow={step}
            aria-label={`Etapa ${step} de 7`}
            className="grid grid-cols-7 gap-1.5"
          >
            {STEP_LABELS.map((label, i) => (
              <span
                key={label}
                className={`h-2 rounded-full transition-colors ${i + 1 < step ? "bg-emerald" : i + 1 === step ? "bg-primary" : "bg-surface-subdued"}`}
              />
            ))}
          </div>
          <ol className="mt-4 hidden flex-wrap gap-x-4 gap-y-2 text-body-sm font-semibold text-text-muted sm:flex">
            {STEP_LABELS.map((label, i) => {
              const stepNumber = i + 1;
              const isActive = stepNumber === step;
              const isDone = stepNumber < step;
              return (
                <li
                  key={label}
                  aria-current={isActive ? "step" : undefined}
                  className={`flex items-center gap-1.5 ${isActive ? "text-primary" : isDone ? "text-emerald" : ""}`}
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                      isActive ? "bg-primary text-white" : isDone ? "bg-emerald text-white" : "bg-surface-subdued"
                    }`}
                  >
                    {isDone ? "✓" : stepNumber}
                  </span>
                  {label}
                </li>
              );
            })}
          </ol>
        </div>

        <div className="rounded-2xl border border-border bg-surface-card p-5 shadow-[var(--shadow-card)] sm:p-8">
          <h1 className="text-headline-md font-extrabold text-graphite">{title}</h1>
          <p className="mt-1 text-body-md text-text-muted">{description}</p>
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="mb-1.5 block text-label-lg text-graphite">{children}</span>;
}

export const inputClass =
  "h-11 w-full rounded-lg border border-border bg-surface-card px-3 text-body-md text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15";

export function ErrorMessage({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div className="rounded-lg border border-red/20 bg-red/10 px-3 py-2 text-body-md font-medium text-red">
      {message}
    </div>
  );
}

export function SuccessMessage({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div className="mb-6 rounded-lg border border-emerald/20 bg-emerald/10 px-4 py-3 text-body-md font-medium text-emerald">
      {message}
    </div>
  );
}

/**
 * Rodapé padrão de navegação de um passo do onboarding — Voltar (link puro,
 * nenhum dado é perdido) + Pular por enquanto (mesmo <form>, via
 * `formAction`/`formNoValidate` — não valida os campos exigidos do passo,
 * já que pular nunca deveria exigir preenchê-los) + o submit normal do
 * passo. Reaproveitado por todos os Passos 2-7 para nunca ter uma lógica
 * de "pular" diferente por tela.
 */
export function StepNavigation({
  backHref,
  skipAction,
  submitLabel,
}: {
  backHref: string;
  skipAction: (formData: FormData) => void | Promise<void>;
  submitLabel: string;
}) {
  return (
    <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <Link href={backHref} className="text-label-lg text-text-muted hover:text-graphite">
          ← Voltar
        </Link>
        <button
          type="submit"
          formAction={skipAction}
          formNoValidate
          className="text-label-lg text-text-muted hover:text-graphite"
        >
          Pular por enquanto
        </button>
      </div>
      <SubmitButton label={submitLabel} />
    </div>
  );
}

/**
 * Cartão de escolha (checkbox) dos passos 3 e 6: ícone + título + descrição, com o estado marcado
 * visível por borda e fundo. O checkbox continua sendo um <input> normal dentro do <label>
 * (mesmos `name`/`defaultChecked`/`checked` de antes), então o envio do formulário não muda.
 */
export function ChoiceCard({
  icon,
  title,
  description,
  children,
  ...checkbox
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  children?: React.ReactNode;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "className" | "title">) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4 transition-colors hover:bg-surface-subdued/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
      {/* o checkbox é o PRIMEIRO controle do <label> (clicar no cartão o marca, mesmo com um campo de texto dentro); order-last o põe à direita */}
      <input type="checkbox" className="order-last mt-1 h-5 w-5 shrink-0 accent-primary" {...checkbox} />
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-label-lg text-graphite">{title}</span>
        {description && <span className="block text-body-md text-text-muted">{description}</span>}
        {children}
      </span>
    </label>
  );
}

import Link from "next/link";

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
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-6">
          <Link href="/" className="text-base font-extrabold text-graphite">
            Menu<span className="text-primary">Next</span>
          </Link>
          <span className="text-xs font-semibold text-text-muted">Etapa {step} de 7</span>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-10">
        {successMessage && <SuccessMessage message={successMessage} />}

        <div className="mb-8">
          <div className="mb-2 text-xs font-semibold text-text-muted">{percent}% concluído</div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-subdued">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
          </div>
          <ol className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold text-text-muted">
            {STEP_LABELS.map((label, i) => {
              const stepNumber = i + 1;
              const isActive = stepNumber === step;
              const isDone = stepNumber < step;
              return (
                <li
                  key={label}
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

        <div className="rounded-2xl border border-border bg-surface-card p-8 shadow-[var(--shadow-card)]">
          <h1 className="text-xl font-extrabold text-graphite">{title}</h1>
          <p className="mt-1 text-sm text-text-muted">{description}</p>
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="mb-1.5 block text-sm font-semibold text-graphite">{children}</span>;
}

export const inputClass =
  "h-11 w-full rounded-lg border border-border bg-surface-card px-3 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15";

export function ErrorMessage({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div className="rounded-lg border border-[#FEF2F2] bg-[#FEF2F2] px-3 py-2 text-sm font-medium text-red">
      {message}
    </div>
  );
}

export function SuccessMessage({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div className="mb-6 rounded-lg border border-[#ECFDF5] bg-[#ECFDF5] px-4 py-3 text-sm font-medium text-emerald">
      {message}
    </div>
  );
}

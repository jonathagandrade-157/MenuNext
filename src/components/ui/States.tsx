export function LoadingState({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Carregando">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-16 w-full animate-pulse rounded-xl bg-surface-subdued" />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-surface-card px-6 py-12 text-center">
      <p className="font-semibold text-graphite">{title}</p>
      {description && <p className="max-w-sm text-body-md text-text-muted">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-red/20 bg-red/10 px-4 py-3 text-body-md font-medium text-red">
      {message}
    </div>
  );
}

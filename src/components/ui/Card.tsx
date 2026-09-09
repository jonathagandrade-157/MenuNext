export function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-xl border border-border bg-surface-card shadow-[var(--shadow-card)] ${className}`}>
      {children}
    </div>
  );
}

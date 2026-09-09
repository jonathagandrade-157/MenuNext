/**
 * Shell da loja pública: mobile-first, com a experiência centralizada em
 * até ~420px também no desktop (ver Sprint 0 §9).
 */
export default function LojaPublicaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface-subdued md:flex md:justify-center md:py-8">
      <div className="min-h-screen w-full bg-surface-card md:min-h-[calc(100vh-4rem)] md:max-w-[420px] md:rounded-2xl md:border md:border-border md:shadow-[var(--shadow-modal)]">
        {children}
      </div>
    </div>
  );
}

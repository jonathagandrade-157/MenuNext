import { BagProvider } from "@/contexts/BagContext";

/**
 * Shell da loja pública: mobile-first, com a experiência centralizada em
 * até ~420px também no desktop (ver Sprint 0 §9). BagProvider aqui (não em
 * cada página) garante que a sacola sobrevive à navegação client-side entre
 * Home, detalhe do produto e sacola dentro da mesma loja.
 */
export default async function LojaPublicaLayout({ children, params }: LayoutProps<"/loja/[slug]">) {
  const { slug } = await params;
  return (
    <div className="min-h-screen bg-surface-subdued md:flex md:justify-center md:py-8">
      <div className="min-h-screen w-full bg-surface-card md:min-h-[calc(100vh-4rem)] md:max-w-[420px] md:rounded-2xl md:border md:border-border md:shadow-[var(--shadow-modal)]">
        <BagProvider slug={slug}>{children}</BagProvider>
      </div>
    </div>
  );
}

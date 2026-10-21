import { BagProvider } from "@/contexts/BagContext";

/**
 * Shell da loja pública: mobile-first, com a experiência centralizada em
 * em coluna única no celular e, a partir de md, numa coluna mais larga
 * (3xl/5xl) para o cardápio e o checkout aproveitarem o desktop. BagProvider aqui (não em
 * cada página) garante que a sacola sobrevive à navegação client-side entre
 * Home, detalhe do produto e sacola dentro da mesma loja.
 */
export default async function LojaPublicaLayout({ children, params }: LayoutProps<"/loja/[slug]">) {
  const { slug } = await params;
  return (
    <div className="min-h-screen bg-surface-subdued md:flex md:justify-center md:py-8">
      <div className="min-h-screen w-full bg-surface-card md:min-h-[calc(100vh-4rem)] md:max-w-3xl lg:max-w-5xl md:rounded-2xl md:border md:border-border md:shadow-[var(--shadow-modal)]">
        <BagProvider slug={slug}>{children}</BagProvider>
      </div>
    </div>
  );
}

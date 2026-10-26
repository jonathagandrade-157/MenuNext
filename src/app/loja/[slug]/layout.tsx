import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BagProvider } from "@/contexts/BagContext";
import { createClient } from "@/lib/supabase/server";
import { getPublicAssetUrl } from "@/lib/storage/assets";
import type { PublicRestaurant } from "@/lib/store";
import { getCachedPublicRestaurant } from "@/lib/storeRestaurant";

/** Falha ao consultar o banco NÃO é "loja inexistente": devolve undefined e deixa a página mostrar o erro. */
async function findRestaurant(slug: string): Promise<PublicRestaurant | null | undefined> {
  try {
    return await getCachedPublicRestaurant(slug);
  } catch {
    return undefined;
  }
}

/** Título, descrição e prévia de link (WhatsApp, Instagram) com a marca do restaurante, não a do MenuNext. */
export async function generateMetadata({ params }: LayoutProps<"/loja/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const restaurant = await findRestaurant(slug);
  if (!restaurant) return {};

  const title = `${restaurant.name} — Cardápio e pedidos online`;
  const description = restaurant.bio?.trim() || `Veja o cardápio de ${restaurant.name} e faça seu pedido online.`;
  const supabase = await createClient();
  const imagePath = restaurant.cover_path ?? restaurant.logo_path;
  const images = imagePath ? [getPublicAssetUrl(supabase, imagePath)] : undefined;

  return {
    title,
    description,
    // Loja bloqueada por cobrança não deve aparecer em buscadores.
    robots: restaurant.subscription_blocked ? { index: false, follow: false } : undefined,
    openGraph: { type: "website", locale: "pt_BR", siteName: restaurant.name, title, description, images },
    twitter: { card: images ? "summary_large_image" : "summary", title, description, images },
  };
}

/**
 * Shell da loja pública: mobile-first, com a experiência centralizada em
 * em coluna única no celular e, a partir de md, numa coluna mais larga
 * (3xl/5xl) para o cardápio e o checkout aproveitarem o desktop. BagProvider aqui (não em
 * cada página) garante que a sacola sobrevive à navegação client-side entre
 * Home, detalhe do produto e sacola dentro da mesma loja.
 *
 * Loja inexistente é decidida AQUI, antes de o loading.tsx começar a enviar a página: assim a resposta sai com
 * status 404 de verdade (e não 200 com aviso), o que importa para buscadores. O visual vem de app/loja/not-found.tsx.
 */
export default async function LojaPublicaLayout({ children, params }: LayoutProps<"/loja/[slug]">) {
  const { slug } = await params;
  if ((await findRestaurant(slug)) === null) notFound();

  return (
    <div className="min-h-screen bg-surface-subdued md:flex md:justify-center md:py-8">
      <div className="min-h-screen w-full bg-surface-card md:min-h-[calc(100vh-4rem)] md:max-w-3xl lg:max-w-5xl md:rounded-2xl md:border md:border-border md:shadow-[var(--shadow-modal)]">
        <BagProvider slug={slug}>{children}</BagProvider>
      </div>
    </div>
  );
}

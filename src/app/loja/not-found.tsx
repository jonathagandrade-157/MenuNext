import type { Metadata } from "next";
import { StoreNotFound } from "@/components/loja/StoreNotFound";

export const metadata: Metadata = { title: "Loja não encontrada — MenuNext" };

/** Aparece quando o layout de /loja/[slug] chama notFound() (slug que não existe ou loja ainda não publicada). */
export default function LojaNotFound() {
  return (
    <div className="min-h-screen bg-surface-subdued md:flex md:justify-center md:py-8">
      <div className="min-h-screen w-full bg-surface-card md:min-h-[calc(100vh-4rem)] md:max-w-3xl md:rounded-2xl md:border md:border-border md:shadow-[var(--shadow-modal)]">
        <StoreNotFound />
      </div>
    </div>
  );
}

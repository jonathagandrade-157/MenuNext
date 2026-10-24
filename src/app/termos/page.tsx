import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { TERMS_INTRO, TERMS_SECTIONS } from "@/lib/legalContent";

export const metadata: Metadata = {
  title: "Termos de Uso — MenuNext",
  description: "Condições de uso da plataforma MenuNext por restaurantes e suas equipes.",
};

export default function TermosPage() {
  return (
    <LegalPage
      title="Termos de Uso"
      intro={TERMS_INTRO}
      sections={TERMS_SECTIONS}
      otherPage={{ href: "/privacidade", label: "Política de Privacidade" }}
    />
  );
}

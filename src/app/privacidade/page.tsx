import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { PRIVACY_INTRO, PRIVACY_SECTIONS } from "@/lib/legalContent";

export const metadata: Metadata = {
  title: "Política de Privacidade e LGPD — MenuNext",
  description: "Como o MenuNext trata dados pessoais de restaurantes e de clientes, conforme a LGPD.",
};

export default function PrivacidadePage() {
  return (
    <LegalPage
      title="Política de Privacidade e LGPD"
      intro={PRIVACY_INTRO}
      sections={PRIVACY_SECTIONS}
      otherPage={{ href: "/termos", label: "Termos de Uso" }}
    />
  );
}

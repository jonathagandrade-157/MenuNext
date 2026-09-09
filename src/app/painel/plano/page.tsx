import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_12"
      title="Plano e assinatura"
      description="Plano contratado (Start, Pro ou Plus), cobrança e trial."
      backHref="/painel"
      backLabel="Voltar ao dashboard"
    />
  );
}

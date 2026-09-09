import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_42"
      title="Onboarding — Passo 4: Configuração de delivery"
      description="Taxa fixa ou por bairro, raio de entrega e valor mínimo do pedido."
      backHref="/onboarding/passo-3"
      backLabel="Voltar ao passo anterior"
    />
  );
}

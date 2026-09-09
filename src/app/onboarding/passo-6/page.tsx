import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_40"
      title="Onboarding — Passo 6: Formas de pagamento"
      description="Chave Pix, dinheiro e maquininha/cartão na entrega ou retirada."
      backHref="/onboarding/passo-5"
      backLabel="Voltar ao passo anterior"
    />
  );
}

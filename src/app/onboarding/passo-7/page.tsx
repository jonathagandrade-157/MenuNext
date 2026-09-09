import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_38"
      title="Onboarding — Passo 7: Primeiro produto"
      description="Cadastro do primeiro item do cardápio para a loja não nascer vazia."
      backHref="/onboarding/passo-6"
      backLabel="Voltar ao passo anterior"
    />
  );
}

import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_45"
      title="Onboarding — Passo 1: Dados do restaurante e URL"
      description="Nome comercial, categoria e endereço da loja (ex.: menunext.com/sua-loja)."
      backHref="/cadastro"
      backLabel="Voltar para o cadastro"
    />
  );
}

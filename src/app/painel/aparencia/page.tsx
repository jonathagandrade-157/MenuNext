import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_20"
      title="Aparência da loja"
      description="Logotipo, banner, cores e personalização visual da loja pública."
      backHref="/painel"
      backLabel="Voltar ao dashboard"
    />
  );
}

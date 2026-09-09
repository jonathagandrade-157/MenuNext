import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_32"
      title="Adicionais e complementos"
      description="Grupos de adicionais obrigatórios ou opcionais aplicáveis aos produtos."
      backHref="/painel"
      backLabel="Voltar ao dashboard"
    />
  );
}

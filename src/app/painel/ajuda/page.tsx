import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_11"
      title="Ajuda"
      description="Central de ajuda e manual de uso do painel."
      backHref="/painel"
      backLabel="Voltar ao dashboard"
    />
  );
}

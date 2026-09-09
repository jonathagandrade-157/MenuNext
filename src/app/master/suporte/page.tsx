import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_4"
      title="Suporte"
      description="Atendimento aos lojistas da plataforma."
      backHref="/master"
      backLabel="Voltar ao dashboard Master"
    />
  );
}

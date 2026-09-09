import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_6"
      title="Usuários Master"
      description="Equipe com acesso administrativo à plataforma."
      backHref="/master"
      backLabel="Voltar ao dashboard Master"
    />
  );
}

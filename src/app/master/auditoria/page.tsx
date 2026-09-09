import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_2"
      title="Auditoria e logs"
      description="Registro de ações sensíveis realizadas na plataforma, incluindo impersonation."
      backHref="/master"
      backLabel="Voltar ao dashboard Master"
    />
  );
}

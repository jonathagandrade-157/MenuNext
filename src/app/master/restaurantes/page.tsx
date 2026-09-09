import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      title="Restaurantes"
      description="Lista de restaurantes (lojistas) cadastrados na plataforma. Tela de listagem não veio explícita no export do Stitch — apenas o detalhe (SCREEN_9); estrutura preparada para a Sprint 1."
      backHref="/master"
      backLabel="Voltar ao dashboard Master"
    />
  );
}

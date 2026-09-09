import { ScreenPlaceholder } from "@/components/scaffold/ScreenPlaceholder";

export default function Page() {
  return (
    <ScreenPlaceholder
      screenId="SCREEN_33"
      title="Novo produto"
      description="Cadastro de produto: fotos, nome, descrição, preço, variantes e adicionais."
      backHref="/painel/produtos"
      backLabel="Voltar para produtos"
    />
  );
}

import { redirect } from "next/navigation";

// Nome, URL e endereço do restaurante agora são editados dentro de Configurações da loja
// (mesmo formulário, InformacoesForm). Esta rota continua existindo para não quebrar links
// antigos nem o checklist de primeiros passos.
export default function InformacoesPage() {
  redirect("/painel/configuracoes#nome-e-endereco");
}

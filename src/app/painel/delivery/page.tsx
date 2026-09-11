import { redirect } from "next/navigation";

// Entrega/retirada e taxa de entrega são configuradas nos Passos 3 e 4 do
// onboarding — que agora funcionam como telas de edição reutilizáveis a
// qualquer momento (Fase de reestruturação do onboarding). Em vez de
// duplicar o mesmo formulário aqui, este item do menu leva direto para lá.
export default function Page() {
  redirect("/onboarding/passo-3");
}

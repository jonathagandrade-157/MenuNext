import { redirect } from "next/navigation";

// Formas de pagamento são configuradas no Passo 6 do onboarding — que agora
// funciona como tela de edição reutilizável a qualquer momento (Fase de
// reestruturação do onboarding). Em vez de duplicar o mesmo formulário
// aqui, este item do menu leva direto para lá.
export default function Page() {
  redirect("/onboarding/passo-6");
}

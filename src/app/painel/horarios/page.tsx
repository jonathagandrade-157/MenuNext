import { redirect } from "next/navigation";

// Horários são configurados no Passo 5 do onboarding — que agora funciona
// como tela de edição reutilizável a qualquer momento (Fase de
// reestruturação do onboarding). Em vez de duplicar o mesmo formulário
// aqui, este item do menu leva direto para lá.
export default function Page() {
  redirect("/onboarding/passo-5");
}

import { redirect } from "next/navigation";
import Link from "next/link";
import { CadastroForm } from "@/components/cadastro/CadastroForm";
import { CheckCircleIcon } from "@/components/ui/icons";
import { getAuthedUser, getMyRestaurant, getOnboardingProgress, ONBOARDING_STEP_PATHS } from "@/lib/tenant";

const BENEFITS = [
  "Pix direto no seu banco, sem taxa por pedido",
  "Delivery próprio, com área de entrega configurável",
  "30 dias grátis para testar, sem cartão de crédito",
];

export default async function CadastroPage(props: PageProps<"/cadastro">) {
  const { supabase, user } = await getAuthedUser();
  if (user) {
    const restaurant = await getMyRestaurant(supabase);
    if (!restaurant) redirect("/onboarding/passo-1");
    if (!restaurant.onboarding_completed) {
      const progress = await getOnboardingProgress(supabase, restaurant.id);
      redirect(ONBOARDING_STEP_PATHS[progress?.current_step ?? 1]);
    }
    redirect("/painel");
  }

  const searchParams = await props.searchParams;
  const mode = searchParams.mode === "login" ? "login" : "signup";

  return (
    <div className="min-h-screen bg-surface md:grid md:grid-cols-2">
      <div className="hidden flex-col justify-between bg-graphite p-12 text-white md:flex">
        <Link href="/" className="text-lg font-extrabold">
          Menu<span className="text-primary">Next</span>
        </Link>
        <div className="space-y-6">
          <p className="text-xs font-bold uppercase tracking-widest text-primary">Etapa 02 &bull; Cadastro Imediato</p>
          <h1 className="text-3xl font-extrabold leading-tight">
            Em poucos minutos seu restaurante estará vendendo online.
          </h1>
          <p className="text-white/70">
            Diga adeus às comissões abusivas. Crie seu cardápio próprio, configure delivery por bairros e receba
            pedidos direto no seu painel em tempo real.
          </p>
          <ul className="space-y-3">
            {BENEFITS.map((benefit) => (
              <li key={benefit} className="flex items-center gap-2 text-sm text-white/80">
                <CheckCircleIcon className="h-4 w-4 shrink-0 text-emerald" />
                {benefit}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-white/40">© 2026 MenuNext Tecnologia para Gastronomia Ltda.</p>
      </div>

      <div className="flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-md rounded-2xl border border-border bg-surface-card p-8 shadow-[var(--shadow-modal)]">
          <CadastroForm mode={mode} />
        </div>
      </div>
    </div>
  );
}

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { acceptTermsAction } from "@/lib/actions/legalAcceptance";
import { LEGAL_LAST_UPDATED } from "@/lib/legal";

/** Tela de reaceite: aparece no lugar do painel quando a pessoa ainda não
 * aceitou a versão atual dos Termos e da Política de Privacidade. A caixa vem
 * desmarcada e é obrigatória; os textos abrem em nova aba para leitura. */
export function TermsGate() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-10">
      <form
        action={acceptTermsAction}
        className="w-full max-w-md space-y-5 rounded-2xl border border-border bg-surface-card p-6 shadow-card"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ShieldCheck className="h-6 w-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-headline-md text-graphite">Atualizamos nossos termos</h1>
          <p className="mt-1 text-body-md text-text-muted">
            Para continuar usando o painel, leia e aceite os Termos de Uso e a Política de Privacidade (versão de{" "}
            {LEGAL_LAST_UPDATED}).
          </p>
        </div>

        <ul className="space-y-2 text-body-md">
          <li>
            <Link href="/termos" target="_blank" className="font-semibold text-primary underline">
              Ler os Termos de Uso
            </Link>
          </li>
          <li>
            <Link href="/privacidade" target="_blank" className="font-semibold text-primary underline">
              Ler a Política de Privacidade
            </Link>
          </li>
        </ul>

        <label className="flex items-start gap-2 text-body-sm text-graphite">
          <input type="checkbox" name="terms" required className="mt-0.5 h-4 w-4 rounded border-border" />
          <span>Li e aceito os Termos de Uso e a Política de Privacidade do MenuNext.</span>
        </label>

        <button
          type="submit"
          className="flex h-11 w-full items-center justify-center rounded-xl bg-primary text-label-lg text-white shadow-[0_8px_20px_-4px_rgba(171,47,0,0.35)] transition-colors hover:bg-primary-container"
        >
          Aceitar e continuar
        </button>
      </form>
    </div>
  );
}

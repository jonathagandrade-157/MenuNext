"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { signInAction, signUpAction } from "@/lib/actions/auth";
import { initialAuthState } from "@/lib/form-state";
import { maskDocument } from "@/lib/document";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" loading={pending} disabled={pending}>
      {pending ? "Processando..." : label}
    </Button>
  );
}

export function CadastroForm({
  mode,
  next,
  defaultEmail,
}: {
  mode: "signup" | "login";
  next?: string;
  defaultEmail?: string;
}) {
  const [signUpState, signUpFormAction] = useActionState(signUpAction, initialAuthState);
  const [signInState, signInFormAction] = useActionState(signInAction, initialAuthState);
  const [docInput, setDocInput] = useState("");

  // Preserva next/email ao alternar entre "Criar conta" e "Entrar" — sem
  // isso, quem veio de um link de convite (JON-27) perderia o destino de
  // pós-login e teria que digitar o e-mail de novo ao trocar de aba.
  const carryParams = new URLSearchParams();
  if (next) carryParams.set("next", next);
  if (defaultEmail) carryParams.set("email", defaultEmail);
  function authLink(base: "/cadastro" | "/cadastro?mode=login"): string {
    const query = carryParams.toString();
    if (!query) return base;
    return `${base}${base.includes("?") ? "&" : "?"}${query}`;
  }

  if (mode === "login") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-extrabold text-graphite">Entrar no MenuNext</h1>
          <p className="mt-1 text-sm text-text-muted">Acesse o painel do seu restaurante.</p>
        </div>

        <form action={signInFormAction} className="space-y-4">
          {next && <input type="hidden" name="next" value={next} />}
          <Field
            label="E-mail"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={defaultEmail}
          />
          <Field label="Senha" name="password" type="password" autoComplete="current-password" required />

          {signInState.status === "error" && <ErrorMessage message={signInState.message} />}

          <SubmitButton label="Entrar" />
        </form>

        <p className="text-center text-sm text-text-muted">
          Ainda não tem uma loja?{" "}
          <Link href={authLink("/cadastro")} className="font-semibold text-primary hover:underline">
            Criar minha loja grátis
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-graphite">Crie sua loja no MenuNext</h1>
        <p className="mt-1 text-sm text-text-muted">
          Comece agora e coloque seu restaurante para vender online.
        </p>
      </div>

      <form action={signUpFormAction} className="space-y-4">
        {next && <input type="hidden" name="next" value={next} />}
        <Field label="Nome da loja" name="storeName" type="text" autoComplete="organization" required />
        <Field label="Nome completo" name="name" type="text" autoComplete="name" required />
        <Field
          label="E-mail"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={defaultEmail}
        />
        <Field label="Telefone" name="phone" type="tel" autoComplete="tel" required />

        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-graphite">CPF ou CNPJ</span>
          <input
            name="document"
            type="text"
            inputMode="numeric"
            required
            value={docInput}
            onChange={(e) => setDocInput(maskDocument(e.target.value))}
            placeholder="000.000.000-00"
            className="h-11 w-full rounded-lg border border-border bg-surface-card px-3 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
          />
          <p className="mt-1.5 text-xs text-text-muted">
            Cada CPF ou CNPJ tem direito a um único período de teste grátis no MenuNext.
          </p>
        </label>

        <Field label="Senha" name="password" type="password" autoComplete="new-password" required minLength={6} />
        <Field
          label="Confirmar senha"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
        />

        <label className="flex items-start gap-2 text-xs text-text-muted">
          <input type="checkbox" name="terms" required className="mt-0.5 h-4 w-4 rounded border-border" />
          <span>Li e aceito os Termos de Uso e a Política de Privacidade do MenuNext.</span>
        </label>

        {signUpState.status === "error" && <ErrorMessage message={signUpState.message} />}

        <SubmitButton label="Começar 30 dias grátis" />

        <p className="text-center text-xs text-text-muted">
          30 dias grátis &bull; Sem cartão de crédito &bull; 0% de comissão por pedido
        </p>
      </form>

      <p className="text-center text-sm text-text-muted">
        Já tem uma conta?{" "}
        <Link href={authLink("/cadastro?mode=login")} className="font-semibold text-primary hover:underline">
          Entrar
        </Link>
      </p>
    </div>
  );
}

function Field({
  label,
  name,
  type,
  autoComplete,
  required,
  minLength,
  defaultValue,
}: {
  label: string;
  name: string;
  type: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  defaultValue?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-graphite">{label}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        defaultValue={defaultValue}
        className="h-11 w-full rounded-lg border border-border bg-surface-card px-3 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
      />
    </label>
  );
}

function ErrorMessage({ message }: { message?: string }) {
  return (
    <div className="rounded-lg border border-[#FEF2F2] bg-[#FEF2F2] px-3 py-2 text-sm font-medium text-red">
      {message}
    </div>
  );
}

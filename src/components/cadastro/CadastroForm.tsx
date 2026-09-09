"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { signInAction, signUpAction } from "@/lib/actions/auth";
import { initialAuthState } from "@/lib/form-state";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" loading={pending} disabled={pending}>
      {pending ? "Processando..." : label}
    </Button>
  );
}

export function CadastroForm({ mode }: { mode: "signup" | "login" }) {
  const [signUpState, signUpFormAction] = useActionState(signUpAction, initialAuthState);
  const [signInState, signInFormAction] = useActionState(signInAction, initialAuthState);

  if (mode === "login") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-extrabold text-graphite">Entrar no MenuNext</h1>
          <p className="mt-1 text-sm text-text-muted">Acesse o painel do seu restaurante.</p>
        </div>

        <form action={signInFormAction} className="space-y-4">
          <Field label="E-mail" name="email" type="email" autoComplete="email" required />
          <Field label="Senha" name="password" type="password" autoComplete="current-password" required />

          {signInState.status === "error" && <ErrorMessage message={signInState.message} />}

          <SubmitButton label="Entrar" />
        </form>

        <p className="text-center text-sm text-text-muted">
          Ainda não tem uma loja?{" "}
          <Link href="/cadastro" className="font-semibold text-primary hover:underline">
            Criar minha loja grátis
          </Link>
        </p>
      </div>
    );
  }

  if (signUpState.status === "confirm_email") {
    return (
      <div className="space-y-4 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#ECFDF5] text-emerald">
          ✓
        </span>
        <h1 className="text-xl font-extrabold text-graphite">Quase lá!</h1>
        <p className="text-sm text-text-muted">{signUpState.message}</p>
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
        <Field label="Nome completo" name="name" type="text" autoComplete="name" required />
        <Field label="E-mail" name="email" type="email" autoComplete="email" required />
        <Field label="Senha" name="password" type="password" autoComplete="new-password" required minLength={6} />
        <Field
          label="Confirmar senha"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
        />

        {signUpState.status === "error" && <ErrorMessage message={signUpState.message} />}

        <SubmitButton label="Criar minha loja grátis" />

        <p className="text-center text-xs text-text-muted">
          30 dias grátis &bull; Sem cartão de crédito &bull; 0% de comissão por pedido
        </p>
      </form>

      <p className="text-center text-sm text-text-muted">
        Já tem uma conta?{" "}
        <Link href="/cadastro?mode=login" className="font-semibold text-primary hover:underline">
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
}: {
  label: string;
  name: string;
  type: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
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

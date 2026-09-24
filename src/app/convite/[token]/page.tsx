import Link from "next/link";
import { getAuthedUser } from "@/lib/tenant";
import { AcceptInviteButton } from "@/components/convite/AcceptInviteButton";

type InviteDetails = {
  restaurant_id: string;
  restaurant_name: string;
  email: string;
  role: "OWNER" | "STAFF";
  status: "pending" | "accepted" | "revoked" | "expired";
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface-card p-8 shadow-[var(--shadow-modal)]">
        <Link href="/" className="mb-6 block text-lg font-extrabold text-graphite">
          Menu<span className="text-primary">Next</span>
        </Link>
        {children}
      </div>
    </div>
  );
}

export default async function ConvitePage({ params }: PageProps<"/convite/[token]">) {
  const { token } = await params;
  const { supabase, user } = await getAuthedUser();

  const { data, error } = await supabase.rpc("get_restaurant_invite_by_token", { p_token: token });
  const invite = (Array.isArray(data) ? data[0] : data) as InviteDetails | undefined;

  if (error || !invite) {
    return (
      <Shell>
        <h1 className="text-xl font-extrabold text-graphite">Convite não encontrado</h1>
        <p className="mt-2 text-sm text-text-muted">
          Este link de convite não é válido. Peça ao dono da loja para gerar um novo.
        </p>
      </Shell>
    );
  }

  if (invite.status === "accepted") {
    return (
      <Shell>
        <h1 className="text-xl font-extrabold text-graphite">Convite já utilizado</h1>
        <p className="mt-2 text-sm text-text-muted">
          Este convite para <span className="font-semibold text-graphite">{invite.restaurant_name}</span> já foi
          aceito. Se você já tem uma conta,{" "}
          <Link href="/cadastro?mode=login" className="font-semibold text-primary hover:underline">
            entre por aqui
          </Link>
          .
        </p>
      </Shell>
    );
  }

  if (invite.status === "revoked") {
    return (
      <Shell>
        <h1 className="text-xl font-extrabold text-graphite">Convite revogado</h1>
        <p className="mt-2 text-sm text-text-muted">
          O dono de <span className="font-semibold text-graphite">{invite.restaurant_name}</span> cancelou este
          convite. Peça um novo link.
        </p>
      </Shell>
    );
  }

  if (invite.status === "expired") {
    return (
      <Shell>
        <h1 className="text-xl font-extrabold text-graphite">Convite expirado</h1>
        <p className="mt-2 text-sm text-text-muted">
          Este convite para <span className="font-semibold text-graphite">{invite.restaurant_name}</span> expirou.
          Peça ao dono da loja para gerar um novo.
        </p>
      </Shell>
    );
  }

  const nextParam = `/convite/${token}`;

  return (
    <Shell>
      <h1 className="text-xl font-extrabold text-graphite">Você foi convidado!</h1>
      <p className="mt-2 text-sm text-text-muted">
        <span className="font-semibold text-graphite">{invite.restaurant_name}</span> convidou{" "}
        <span className="font-semibold text-graphite">{invite.email}</span> para fazer parte da equipe no painel do
        restaurante.
      </p>

      <div className="mt-6">
        {user ? (
          <AcceptInviteButton token={token} restaurantName={invite.restaurant_name} />
        ) : (
          <div className="space-y-3">
            <Link
              href={`/cadastro?next=${encodeURIComponent(nextParam)}&email=${encodeURIComponent(invite.email)}`}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-white transition-all hover:bg-[#ff5436]"
            >
              Criar conta e entrar
            </Link>
            <Link
              href={`/cadastro?mode=login&next=${encodeURIComponent(nextParam)}&email=${encodeURIComponent(invite.email)}`}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface-card px-5 text-sm font-semibold text-graphite hover:bg-surface"
            >
              Já tenho conta
            </Link>
            <p className="text-center text-xs text-text-muted">
              Use o e-mail <span className="font-semibold">{invite.email}</span> — é o que recebeu o convite.
            </p>
          </div>
        )}
      </div>
    </Shell>
  );
}

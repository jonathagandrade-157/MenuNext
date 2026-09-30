"use client";

import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Modal } from "@/components/ui/Modal";
import { CopyLinkButton } from "@/components/onboarding/CopyLinkButton";
import { removeMemberAction, resendInviteAction, revokeInviteAction } from "@/lib/actions/invites";
import type { RestaurantInvite, RestaurantMember } from "@/lib/tenant";
import { InviteFormFields } from "./InviteFormFields";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function initialsOf(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function Avatar({ label, tone }: { label: string; tone: "owner" | "staff" | "invite" }) {
  const toneClasses =
    tone === "owner"
      ? "bg-primary/15 text-primary"
      : tone === "staff"
        ? "bg-blue/15 text-blue"
        : "bg-surface-subdued text-text-muted";
  return (
    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold ${toneClasses}`}>
      {initialsOf(label)}
    </div>
  );
}

function inviteStatusBadge(invite: RestaurantInvite) {
  if (invite.status === "accepted") return <Badge tone="success">Aceito</Badge>;
  if (invite.status === "revoked") return <Badge tone="neutral">Revogado</Badge>;
  if (new Date(invite.expires_at) < new Date()) return <Badge tone="warning">Expirado</Badge>;
  return <Badge tone="info">Pendente</Badge>;
}

export function UsuariosClient({
  members,
  invites,
  currentUserId,
}: {
  members: RestaurantMember[];
  invites: RestaurantInvite[];
  currentUserId: string;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [revoking, setRevoking] = useState<RestaurantInvite | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<RestaurantMember | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [resendUrl, setResendUrl] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();

  const pendingInvites = invites.filter((invite) => invite.status === "pending");
  const historyInvites = invites.filter((invite) => invite.status !== "pending");
  const staffCount = members.filter((m) => m.role === "STAFF").length;

  const normalizedSearch = search.trim().toLowerCase();
  const filteredMembers = useMemo(() => {
    if (!normalizedSearch) return members;
    return members.filter((m) =>
      [m.name, m.email, m.phone].some((field) => field?.toLowerCase().includes(normalizedSearch))
    );
  }, [members, normalizedSearch]);
  const filteredPendingInvites = useMemo(() => {
    if (!normalizedSearch) return pendingInvites;
    return pendingInvites.filter((i) => i.email.toLowerCase().includes(normalizedSearch));
  }, [pendingInvites, normalizedSearch]);

  function handleConfirmRevoke() {
    if (!revoking) return;
    setRevokeError(null);
    startTransition(async () => {
      const result = await revokeInviteAction(revoking.id);
      if (!result.ok) {
        setRevokeError(result.error ?? "Não foi possível revogar o convite.");
        return;
      }
      setRevoking(null);
    });
  }

  function handleConfirmRemove() {
    if (!removing) return;
    setRemoveError(null);
    startTransition(async () => {
      const result = await removeMemberAction(removing.id);
      if (!result.ok) {
        setRemoveError(result.error ?? "Não foi possível remover este membro.");
        return;
      }
      setRemoving(null);
    });
  }

  function handleResend(invite: RestaurantInvite) {
    setResendError(null);
    setPendingId(invite.id);
    startTransition(async () => {
      const result = await resendInviteAction(invite.id);
      setPendingId(null);
      if (!result.ok) {
        setResendError(result.error ?? "Não foi possível reenviar o convite.");
        return;
      }
      setResendUrl(result.inviteUrl ?? null);
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <nav className="flex items-center gap-2 text-xs font-medium text-text-muted">
        <span>Painel</span>
        <span>/</span>
        <span className="font-bold text-graphite">Usuários</span>
      </nav>

      <div className="flex flex-col justify-between gap-4 border-b border-border pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-graphite">Usuários e permissões</h1>
          <p className="mt-0.5 text-sm font-medium text-text-muted">
            Gerencie quem tem acesso ao painel do seu restaurante.
          </p>
        </div>
        <Button onClick={() => setInviteOpen(true)} className="self-start sm:self-auto">
          <span className="text-lg leading-none">+</span>
          Convidar membro
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-medium text-text-muted">Total de usuários</p>
          <p className="mt-1 text-2xl font-black text-graphite">{members.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-text-muted">Colaboradores</p>
          <p className="mt-1 text-2xl font-black text-graphite">{staffCount}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-text-muted">Convites pendentes</p>
          <p className="mt-1 text-2xl font-black text-graphite">{pendingInvites.length}</p>
        </Card>
      </div>

      <Card className="p-3.5">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome, e-mail ou telefone..."
          className="h-9 w-full max-w-md rounded-lg border border-border bg-surface px-3 text-xs text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
        />
      </Card>

      {removeError && <ErrorState message={removeError} />}

      <Card className="overflow-hidden p-0">
        <div className="border-b border-border bg-surface-subdued/70 px-5 py-3">
          <h2 className="text-sm font-bold text-graphite">Equipe ({filteredMembers.length})</h2>
        </div>
        <div className="divide-y divide-border">
          {filteredMembers.map((member) => (
            <div key={member.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar label={member.name || member.email} tone={member.role === "OWNER" ? "owner" : "staff"} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-graphite">
                    {member.name || member.email}
                    {member.user_id === currentUserId && (
                      <span className="ml-2 text-xs font-medium text-text-muted">(Você)</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-text-muted">{member.email}</p>
                  {member.phone && <p className="truncate text-xs text-text-muted">{member.phone}</p>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={member.role === "OWNER" ? "info" : "neutral"}>
                  {member.role === "OWNER" ? "Proprietário" : "Colaborador"}
                </Badge>
                {member.role === "STAFF" && (
                  <button
                    type="button"
                    onClick={() => {
                      setRemoveError(null);
                      setRemoving(member);
                    }}
                    className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-red hover:bg-red/10"
                  >
                    Remover
                  </button>
                )}
              </div>
            </div>
          ))}
          {filteredMembers.length === 0 && (
            <div className="px-5 py-8">
              <EmptyState title="Nenhum membro encontrado." description="Ajuste a busca ou convide alguém novo." />
            </div>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-border bg-surface-subdued/70 px-5 py-3">
          <h2 className="text-sm font-bold text-graphite">Convites pendentes ({filteredPendingInvites.length})</h2>
        </div>

          {(revokeError || resendError) && (
            <div className="px-5 pt-3">
              <ErrorState message={revokeError ?? resendError ?? ""} />
            </div>
          )}

          {filteredPendingInvites.length === 0 ? (
            <div className="px-5 py-8">
              <EmptyState
                title="Nenhum convite pendente."
                description="Convide alguém da sua equipe para acessar o painel (cozinha, atendimento, etc.)."
              />
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filteredPendingInvites.map((invite) => (
                <div key={invite.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar label={invite.email} tone="invite" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-graphite">{invite.email}</p>
                      <p className="text-xs text-text-muted">Enviado em {formatDate(invite.created_at)}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {inviteStatusBadge(invite)}
                    <button
                      type="button"
                      disabled={isPending && pendingId === invite.id}
                      onClick={() => handleResend(invite)}
                      className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-graphite hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                    >
                      Reenviar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRevokeError(null);
                        setRevoking(invite);
                      }}
                      className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-red hover:bg-red/10"
                    >
                      Revogar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {historyInvites.length > 0 && (
            <>
              <div className="border-y border-border bg-surface-subdued/70 px-5 py-3">
                <h2 className="text-sm font-bold text-graphite">Histórico</h2>
              </div>
              <div className="divide-y divide-border">
                {historyInvites.map((invite) => (
                  <div key={invite.id} className="flex items-center justify-between gap-3 px-5 py-3.5 opacity-70">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar label={invite.email} tone="invite" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-graphite">{invite.email}</p>
                        <p className="text-xs text-text-muted">Enviado em {formatDate(invite.created_at)}</p>
                      </div>
                    </div>
                    {inviteStatusBadge(invite)}
                  </div>
                ))}
              </div>
            </>
          )}
      </Card>

      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Convidar membro">
        <InviteFormFields onDone={() => setInviteOpen(false)} />
      </Modal>

      <Modal open={revoking !== null} onClose={() => setRevoking(null)} title="Revogar convite?">
        <div className="space-y-4">
          <p className="text-sm text-text-muted">
            O link enviado para <span className="font-semibold text-graphite">{revoking?.email}</span> deixará de
            funcionar. Você pode convidar essa pessoa novamente depois.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRevoking(null)} disabled={isPending}>
              Cancelar
            </Button>
            <button
              type="button"
              onClick={handleConfirmRevoke}
              disabled={isPending}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-red px-5 text-sm font-semibold text-white transition-all duration-150 hover:bg-[#dc2626] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
              Revogar
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={removing !== null} onClose={() => setRemoving(null)} title="Remover da equipe?">
        <div className="space-y-4">
          <p className="text-sm text-text-muted">
            <span className="font-semibold text-graphite">{removing?.name || removing?.email}</span> perderá o
            acesso ao painel imediatamente. Você pode convidar essa pessoa novamente depois, se precisar.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRemoving(null)} disabled={isPending}>
              Cancelar
            </Button>
            <button
              type="button"
              onClick={handleConfirmRemove}
              disabled={isPending}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-red px-5 text-sm font-semibold text-white transition-all duration-150 hover:bg-[#dc2626] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
              Remover
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={resendUrl !== null} onClose={() => setResendUrl(null)} title="Convite reenviado">
        <div className="space-y-4">
          <p className="text-sm text-text-muted">Novo link gerado (o anterior parou de funcionar). Copie e compartilhe:</p>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-subdued px-3 py-2.5">
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-graphite">{resendUrl}</p>
          </div>
          <div className="flex justify-end gap-2">
            {resendUrl && <CopyLinkButton url={resendUrl} />}
            <Button onClick={() => setResendUrl(null)}>Concluir</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

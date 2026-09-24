"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Modal } from "@/components/ui/Modal";
import { CopyLinkButton } from "@/components/onboarding/CopyLinkButton";
import { resendInviteAction, revokeInviteAction } from "@/lib/actions/invites";
import type { RestaurantInvite, RestaurantMember } from "@/lib/tenant";
import { InviteFormFields } from "./InviteFormFields";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
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
  isOwner,
}: {
  members: RestaurantMember[];
  invites: RestaurantInvite[];
  currentUserId: string;
  isOwner: boolean;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [revoking, setRevoking] = useState<RestaurantInvite | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [resendUrl, setResendUrl] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const pendingInvites = invites.filter((invite) => invite.status === "pending");
  const historyInvites = invites.filter((invite) => invite.status !== "pending");

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
        {isOwner && (
          <Button onClick={() => setInviteOpen(true)} className="self-start sm:self-auto">
            <span className="text-lg leading-none">+</span>
            Convidar membro
          </Button>
        )}
      </div>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-border bg-surface-subdued/70 px-5 py-3">
          <h2 className="text-sm font-bold text-graphite">Equipe ({members.length})</h2>
        </div>
        <div className="divide-y divide-border">
          {members.map((member) => (
            <div key={member.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-graphite">
                  {member.name || member.email}
                  {member.user_id === currentUserId && (
                    <span className="ml-2 text-xs font-medium text-text-muted">(Você)</span>
                  )}
                </p>
                <p className="truncate text-xs text-text-muted">{member.email}</p>
              </div>
              <Badge tone={member.role === "OWNER" ? "info" : "neutral"}>
                {member.role === "OWNER" ? "Proprietário" : "Staff"}
              </Badge>
            </div>
          ))}
        </div>
      </Card>

      {isOwner && (
        <Card className="overflow-hidden p-0">
          <div className="border-b border-border bg-surface-subdued/70 px-5 py-3">
            <h2 className="text-sm font-bold text-graphite">Convites pendentes ({pendingInvites.length})</h2>
          </div>

          {(revokeError || resendError) && (
            <div className="px-5 pt-3">
              <ErrorState message={revokeError ?? resendError ?? ""} />
            </div>
          )}

          {pendingInvites.length === 0 ? (
            <div className="px-5 py-8">
              <EmptyState
                title="Nenhum convite pendente."
                description="Convide alguém da sua equipe para acessar o painel (cozinha, atendimento, etc.)."
              />
            </div>
          ) : (
            <div className="divide-y divide-border">
              {pendingInvites.map((invite) => (
                <div key={invite.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-graphite">{invite.email}</p>
                    <p className="text-xs text-text-muted">Enviado em {formatDate(invite.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2">
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
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-graphite">{invite.email}</p>
                      <p className="text-xs text-text-muted">Enviado em {formatDate(invite.created_at)}</p>
                    </div>
                    {inviteStatusBadge(invite)}
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      )}

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

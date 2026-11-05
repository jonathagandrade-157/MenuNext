"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { createTicketAction, replyTicketAction, closeTicketAction } from "@/lib/actions/supportMerchant";
import { masterReplyTicketAction, masterSetTicketPriorityAction, masterSetTicketStatusAction } from "@/lib/actions/supportMaster";
import {
  BODY_MAX, MERCHANT_PRIORITIES, SUBJECT_MAX, TICKET_PRIORITY_LABELS, TICKET_STATUS_LABELS,
  type Ticket, type TicketMessage, type TicketPriority, type TicketStatus,
} from "@/lib/support";

const INPUT = "w-full rounded-xl border border-border bg-surface-card px-3.5 py-2.5 text-body-md text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15";
const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const priorityTone = (p: TicketPriority) => (p === "urgent" ? "danger" : p === "high" ? "warning" : "neutral");
const statusTone = (s: TicketStatus) => (s === "open" ? "info" : s === "waiting_customer" ? "warning" : s === "resolved" ? "success" : "neutral");

/** Mesma mesa para o lojista e para a plataforma; o `mode` só escolhe as ações (as RPCs conferem o papel de novo). */
export function SupportDesk({
  mode, basePath, tickets, selected, messages, statusFilter,
}: {
  mode: "merchant" | "master"; basePath: string; tickets: Ticket[]; selected: Ticket | null; messages: TicketMessage[]; statusFilter?: TicketStatus | null;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("normal");
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string; id?: string }>, after?: (id?: string) => void) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "Não foi possível concluir.");
      after?.(r.id);
      router.refresh();
    });
  }

  const closed = selected?.status === "closed";

  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
      <div className="space-y-3">
        {mode === "merchant" && (
          <Button className="w-full" onClick={() => { setCreating(true); setError(null); }}>Novo chamado</Button>
        )}
        {mode === "master" && (
          <div className="flex flex-wrap gap-1 rounded-xl bg-surface-subdued p-1">
            {([[null, "Todos"], ["open", "Abertos"], ["waiting_customer", "Aguardando lojista"], ["resolved", "Resolvidos"], ["closed", "Encerrados"]] as const).map(([v, label]) => (
              <Link key={label} href={v ? `${basePath}?status=${v}` : basePath} className={`rounded-lg px-3 py-1.5 text-label-md ${statusFilter === v || (!statusFilter && v === null) ? "bg-surface-card text-graphite shadow-card" : "text-text-muted"}`}>
                {label}
              </Link>
            ))}
          </div>
        )}
        {tickets.length === 0 ? (
          <EmptyState title="Nenhum chamado." description={mode === "merchant" ? "Abra um chamado para falar com o suporte." : "A fila está vazia."} />
        ) : (
          <Card className="overflow-hidden p-0">
            <ul className="divide-y divide-border">
              {tickets.map((t) => (
                <li key={t.id}>
                  <Link href={`${basePath}?chamado=${t.id}${statusFilter ? `&status=${statusFilter}` : ""}`} className={`block px-4 py-3 hover:bg-surface-subdued ${selected?.id === t.id ? "bg-surface-subdued" : ""}`}>
                    <p className="truncate font-semibold text-graphite">{t.subject}</p>
                    {t.restaurantName && <p className="truncate text-body-sm text-text-muted">{t.restaurantName}</p>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge tone={statusTone(t.status)}>{mode === "master" && t.status === "waiting_customer" ? "Aguardando lojista" : TICKET_STATUS_LABELS[t.status]}</Badge>
                      <Badge tone={priorityTone(t.priority)}>{TICKET_PRIORITY_LABELS[t.priority]}</Badge>
                      <span className="text-body-sm text-text-muted">{when(t.lastMessageAt)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <div className="space-y-4">
        {error && <ErrorState message={error} />}

        {creating && mode === "merchant" && (
          <Card className="space-y-3 p-4">
            <h2 className="text-headline-sm text-graphite">Novo chamado</h2>
            <input value={subject} maxLength={SUBJECT_MAX} onChange={(e) => setSubject(e.target.value)} placeholder="Assunto" aria-label="Assunto" className={INPUT} />
            <textarea value={body} maxLength={BODY_MAX} onChange={(e) => setBody(e.target.value)} rows={5} placeholder="Descreva o problema. Não envie senhas nem dados de cartão." aria-label="Mensagem" className={INPUT} />
            <label className="flex items-center gap-2 text-label-md text-graphite">
              Prioridade
              <select value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)} className="h-10 rounded-xl border border-border bg-surface-card px-2">
                {MERCHANT_PRIORITIES.map((p) => <option key={p} value={p}>{TICKET_PRIORITY_LABELS[p]}</option>)}
              </select>
            </label>
            <div className="flex gap-2">
              <Button loading={pending} disabled={pending} onClick={() => run(() => createTicketAction(subject, body, priority), (id) => { setCreating(false); setSubject(""); setBody(""); if (id) router.push(`${basePath}?chamado=${id}`); })}>Enviar chamado</Button>
              <Button variant="ghost" onClick={() => setCreating(false)}>Cancelar</Button>
            </div>
          </Card>
        )}

        {selected ? (
          <Card className="space-y-4 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-headline-sm text-graphite">{selected.subject}</h2>
                <p className="text-body-sm text-text-muted">{selected.restaurantName ? `${selected.restaurantName} · ` : ""}aberto em {when(selected.createdAt)}</p>
              </div>
              {mode === "merchant" && !closed && (
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => closeTicketAction(selected.id))}>Encerrar chamado</Button>
              )}
              {mode === "master" && (
                <div className="flex flex-wrap gap-2">
                  <select aria-label="Prioridade" value={selected.priority} disabled={pending} onChange={(e) => run(() => masterSetTicketPriorityAction(selected.id, e.target.value))} className="h-9 rounded-xl border border-border bg-surface-card px-2 text-label-md">
                    {(Object.keys(TICKET_PRIORITY_LABELS) as TicketPriority[]).map((p) => <option key={p} value={p}>{TICKET_PRIORITY_LABELS[p]}</option>)}
                  </select>
                  <select aria-label="Status" value={selected.status} disabled={pending} onChange={(e) => run(() => masterSetTicketStatusAction(selected.id, e.target.value))} className="h-9 rounded-xl border border-border bg-surface-card px-2 text-label-md">
                    {(Object.keys(TICKET_STATUS_LABELS) as TicketStatus[]).map((s) => <option key={s} value={s}>{TICKET_STATUS_LABELS[s]}</option>)}
                  </select>
                </div>
              )}
            </div>

            <ul className="space-y-3">
              {messages.map((m) => {
                const mine = (m.authorKind === "merchant") === (mode === "merchant");
                return (
                  <li key={m.id} className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${mine ? "ml-auto bg-primary/10" : "bg-surface-subdued"}`}>
                    <p className="whitespace-pre-wrap break-words text-body-md text-graphite">{m.body}</p>
                    <p className="mt-1 text-body-sm text-text-muted">{m.authorKind === "platform" ? "Suporte MenuNext" : "Lojista"} · {when(m.createdAt)}</p>
                  </li>
                );
              })}
            </ul>

            {closed ? (
              <p className="text-body-md text-text-muted">Chamado encerrado. {mode === "master" ? "Mude o status para reabrir." : "Abra um novo chamado se precisar."}</p>
            ) : (
              <div className="space-y-2">
                <textarea value={reply} maxLength={BODY_MAX} onChange={(e) => setReply(e.target.value)} rows={3} placeholder="Escreva sua resposta" aria-label="Resposta" className={INPUT} />
                <Button loading={pending} disabled={pending || !reply.trim()} onClick={() => run(() => (mode === "merchant" ? replyTicketAction(selected.id, reply) : masterReplyTicketAction(selected.id, reply)), () => setReply(""))}>Responder</Button>
              </div>
            )}
          </Card>
        ) : (
          !creating && <Card className="p-8 text-center text-body-md text-text-muted">Selecione um chamado para ver a conversa.</Card>
        )}
      </div>
    </div>
  );
}

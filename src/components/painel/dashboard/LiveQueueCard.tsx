import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { LiveQueue } from "@/lib/dashboard";

export function LiveQueueCard({ queue }: { queue: LiveQueue }) {
  const total = queue.novos + queue.preparando + queue.prontos;

  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-body-lg font-bold text-graphite">Pedidos agora</h2>
        <Badge tone="success" pulse>
          Atualizado agora
        </Badge>
      </div>

      <p className="mt-3 text-headline-lg text-graphite">
        {total} <span className="text-body-lg font-semibold text-text-muted">em andamento</span>
      </p>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-red/10 py-2">
          <p className="text-headline-sm text-red">{queue.novos}</p>
          <p className="text-[11px] font-semibold text-red">Novos</p>
        </div>
        <div className="rounded-lg bg-amber/10 py-2">
          <p className="text-headline-sm text-amber-strong">{queue.preparando}</p>
          <p className="text-[11px] font-semibold text-amber-strong">Em preparo</p>
        </div>
        <div className="rounded-lg bg-emerald/10 py-2">
          <p className="text-headline-sm text-emerald">{queue.prontos}</p>
          <p className="text-[11px] font-semibold text-emerald">Prontos</p>
        </div>
      </div>

      <Link
        href="/painel/pedidos"
        className="mt-4 inline-flex h-10 items-center justify-center rounded-xl bg-primary text-body-md font-bold text-white transition-all hover:bg-primary-container"
      >
        Ver pedidos no Kanban →
      </Link>
    </Card>
  );
}

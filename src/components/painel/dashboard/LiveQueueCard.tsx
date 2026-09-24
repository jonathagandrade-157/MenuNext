import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { LiveQueue } from "@/lib/dashboard";

export function LiveQueueCard({ queue }: { queue: LiveQueue }) {
  const total = queue.novos + queue.preparando + queue.prontos;

  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-extrabold text-graphite">Pedidos agora</h2>
        <Badge tone="success" pulse>
          Atualizado agora
        </Badge>
      </div>

      <p className="mt-3 text-3xl font-black text-graphite">
        {total} <span className="text-base font-semibold text-text-muted">em andamento</span>
      </p>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-[#FEF2F2] py-2">
          <p className="text-lg font-extrabold text-red">{queue.novos}</p>
          <p className="text-[11px] font-semibold text-red">Novos</p>
        </div>
        <div className="rounded-lg bg-[#FFFBEB] py-2">
          <p className="text-lg font-extrabold text-[#B45309]">{queue.preparando}</p>
          <p className="text-[11px] font-semibold text-[#B45309]">Em preparo</p>
        </div>
        <div className="rounded-lg bg-[#ECFDF5] py-2">
          <p className="text-lg font-extrabold text-emerald">{queue.prontos}</p>
          <p className="text-[11px] font-semibold text-emerald">Prontos</p>
        </div>
      </div>

      <Link
        href="/painel/pedidos"
        className="mt-4 inline-flex h-10 items-center justify-center rounded-xl bg-primary text-sm font-bold text-white transition-all hover:bg-[#ff5436]"
      >
        Ver pedidos no Kanban →
      </Link>
    </Card>
  );
}

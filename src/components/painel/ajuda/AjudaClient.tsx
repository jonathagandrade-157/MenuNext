"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";

type Guide = { title: string; description: string; href: string };
type FaqItem = { question: string; answer: string };

const GUIDES: Guide[] = [
  { title: "Como configurar meu cardápio?", description: "Categorias, produtos, fotos e adicionais.", href: "/painel/categorias" },
  { title: "Como configurar o delivery?", description: "Raio de entrega, taxa e pedido mínimo.", href: "/painel/delivery" },
  { title: "Como acompanho os pedidos?", description: "Fila em tempo real, da chegada até a entrega.", href: "/painel/pedidos" },
  { title: "Como configuro o Pix?", description: "Chave de recebimento e formas de pagamento aceitas.", href: "/painel/pagamentos" },
  { title: "Como compartilho minha loja?", description: "Link e QR Code para clientes pedirem direto.", href: "/painel" },
];

const FAQ: FaqItem[] = [
  {
    question: "Como meu cliente faz um pedido?",
    answer:
      "O cliente acessa o link exclusivo da sua loja (ou escaneia o QR Code), vê o cardápio com fotos e adicionais, escolhe delivery ou retirada e finaliza o pedido — sem precisar baixar aplicativo nem criar conta.",
  },
  {
    question: "O cliente precisa criar uma conta?",
    answer: "Não. O checkout é feito como convidado, só com nome, telefone e endereço (quando for delivery).",
  },
  {
    question: "Como recebo um novo pedido?",
    answer:
      "Ele aparece em tempo real na coluna \"Novos\" de Pedidos (Kanban), com aviso sonoro. Não precisa atualizar a página.",
  },
  {
    question: "Como pauso os pedidos se a cozinha estiver cheia?",
    answer:
      "Em Configurações, pause a loja: o cardápio continua visível para os clientes, mas o checkout fica bloqueado até você reabrir.",
  },
  {
    question: "Como altero o horário da loja?",
    answer: "Em Horários, defina os dias e faixas de funcionamento — a loja pública respeita isso automaticamente.",
  },
  {
    question: "Como marco um produto como indisponível?",
    answer: "Em Produtos, use o toggle de disponibilidade do item — some do cardápio público até você reativar.",
  },
  {
    question: "Como funciona o rastreamento do pedido?",
    answer: "O cliente recebe um link de acompanhamento que mostra o status em tempo real, do recebimento até a entrega.",
  },
  {
    question: "Como altero meu plano?",
    answer: "Gestão de plano e assinatura ainda não está disponível no painel — em breve.",
  },
];

export function AjudaClient({
  hasChecklistSlot,
  supportEmail,
  supportWhatsapp,
}: {
  hasChecklistSlot?: React.ReactNode;
  supportEmail: string | null;
  supportWhatsapp: string | null;
}) {
  const [search, setSearch] = useState("");
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

  const query = search.trim().toLowerCase();

  const filteredGuides = useMemo(
    () => (query ? GUIDES.filter((g) => g.title.toLowerCase().includes(query) || g.description.toLowerCase().includes(query)) : GUIDES),
    [query]
  );

  const filteredFaq = useMemo(
    () => (query ? FAQ.filter((f) => f.question.toLowerCase().includes(query) || f.answer.toLowerCase().includes(query)) : FAQ),
    [query]
  );

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-6 py-10">
      <div>
        <h1 className="text-2xl font-extrabold text-graphite">Ajuda e manual de uso</h1>
        <p className="mt-1 text-sm text-text-muted">Encontre respostas rápidas para configurar e operar seu restaurante.</p>
      </div>

      <label className="block">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Pesquise por pedido, cardápio, delivery, Pix, pausar loja..."
          className="h-12 w-full rounded-xl border border-border bg-surface-card px-4 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
        />
      </label>

      {hasChecklistSlot}

      <div>
        <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-text-muted">Guias rápidos</h2>
        {filteredGuides.length === 0 ? (
          <p className="text-sm text-text-muted">Nenhum guia encontrado para essa busca.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {filteredGuides.map((guide) => (
              <Link key={guide.href} href={guide.href}>
                <Card className="h-full p-4 transition-colors hover:border-primary/40">
                  <h3 className="text-sm font-bold text-graphite">{guide.title}</h3>
                  <p className="mt-1 text-xs text-text-muted">{guide.description}</p>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-text-muted">Perguntas frequentes</h2>
        {filteredFaq.length === 0 ? (
          <p className="text-sm text-text-muted">Nenhuma pergunta encontrada para essa busca.</p>
        ) : (
          <Card className="divide-y divide-border overflow-hidden p-0">
            {filteredFaq.map((item, index) => {
              const open = openFaqIndex === index;
              return (
                <div key={item.question}>
                  <button
                    type="button"
                    onClick={() => setOpenFaqIndex(open ? null : index)}
                    className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left"
                  >
                    <span className="text-sm font-semibold text-graphite">{item.question}</span>
                    <span className="shrink-0 text-text-muted">{open ? "−" : "+"}</span>
                  </button>
                  {open && <p className="px-5 pb-4 text-sm text-text-muted">{item.answer}</p>}
                </div>
              );
            })}
          </Card>
        )}
      </div>

      {(supportEmail || supportWhatsapp) && (
        <Card className="p-5">
          <h2 className="text-sm font-extrabold text-graphite">Precisa de ajuda humana?</h2>
          <p className="mt-1 text-sm text-text-muted">Fale direto com o suporte do MenuNext.</p>
          <div className="mt-3 flex flex-wrap gap-2.5">
            {supportWhatsapp && (
              <a
                href={`https://wa.me/55${supportWhatsapp}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center rounded-xl bg-emerald px-4 text-sm font-semibold text-white transition-all hover:opacity-90"
              >
                Falar no WhatsApp
              </a>
            )}
            {supportEmail && (
              <a
                href={`mailto:${supportEmail}`}
                className="inline-flex h-10 items-center rounded-xl border border-border bg-surface-card px-4 text-sm font-semibold text-graphite hover:bg-surface"
              >
                {supportEmail}
              </a>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

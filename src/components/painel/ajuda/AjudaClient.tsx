"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  BadgePercent,
  ChevronDown,
  Landmark,
  LifeBuoy,
  Mail,
  MessageCircle,
  QrCode,
  Search,
  Bike,
  ClipboardList,
  UtensilsCrossed,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/Card";

type Guide = { title: string; description: string; href: string; icon: LucideIcon };
type FaqItem = { question: string; answer: string };

const GUIDES: Guide[] = [
  { title: "Montar o cardápio", description: "Categorias, produtos, fotos, adicionais e destaques.", href: "/painel/categorias", icon: UtensilsCrossed },
  { title: "Configurar o delivery", description: "Raio de entrega, taxa, bairros e pedido mínimo.", href: "/painel/delivery", icon: Bike },
  { title: "Acompanhar os pedidos", description: "Fila em tempo real, da chegada até a entrega.", href: "/painel/pedidos", icon: ClipboardList },
  { title: "Receber por Pix, dinheiro e cartão", description: "Chave Pix e formas de pagamento aceitas.", href: "/painel/pagamentos", icon: Landmark },
  { title: "Abrir e fechar o caixa", description: "Venda de balcão, troco e fechamento do dia.", href: "/painel/caixa", icon: Landmark },
  { title: "Criar promoções e cupons", description: "Desconto automático ou por código, sem acumular.", href: "/painel/marketing", icon: BadgePercent },
  { title: "Compartilhar a loja", description: "Link, QR Code e cartaz para imprimir.", href: "/painel/configuracoes#divulgacao", icon: QrCode },
  { title: "Convidar a equipe", description: "Atendentes operam pedidos e caixa, sem mexer em preços.", href: "/painel/usuarios", icon: Users },
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
      "Em Configurações, no card Status da loja, pause a loja: o cardápio continua visível para os clientes, mas o checkout fica bloqueado até você reabrir.",
  },
  {
    question: "Onde altero o nome, o endereço e o link da minha loja?",
    answer:
      "Em Configurações, na seção Nome e endereço. Se mudar o link (a parte depois de /loja/), lembre de avisar seus clientes e atualizar o QR Code impresso.",
  },
  {
    question: "Como altero o horário da loja?",
    answer: "Em Horários, defina os dias e faixas de funcionamento — a loja pública respeita isso automaticamente.",
  },
  {
    question: "Como marco um produto como indisponível?",
    answer: "Em Produtos, use o toggle de disponibilidade do item — some do cardápio público até você reativar. O atendente também pode fazer isso.",
  },
  {
    question: "Como destaco produtos ou coloco um aviso na loja?",
    answer:
      "Em Produtos, a estrela coloca o item na seção Destaques do cardápio. Em Aparência você escreve um banner promocional que aparece no topo da loja.",
  },
  {
    question: "Como funciona o caixa (abrir e fechar)?",
    answer:
      "Antes de vender no balcão, abra o caixa informando o dinheiro que já está na gaveta. Ao fechar, conte o dinheiro: o sistema mostra se sobrou ou faltou em relação ao esperado (fundo + vendas em dinheiro). Sem caixa aberto, a venda de balcão fica bloqueada.",
  },
  {
    question: "Posso usar promoção e cupom juntos?",
    answer:
      "Não acumulam. Se uma promoção automática e um cupom valem para o mesmo pedido, o cliente leva o maior desconto. O cupom só gasta um uso se for ele que vencer.",
  },
  {
    question: "Como funciona o rastreamento do pedido?",
    answer: "O cliente recebe um link de acompanhamento que mostra o status em tempo real, do recebimento até a entrega.",
  },
  {
    question: "Como assino ou altero meu plano?",
    answer:
      "Em Plano (menu Conta, só para o dono da loja) você vê a situação da assinatura e escolhe um plano. Para trocar de plano com uma assinatura ativa, fale com o suporte.",
  },
  {
    question: "O que acontece quando o período de teste termina?",
    answer:
      "Depois dos 30 dias de teste, o painel e a loja pública ficam bloqueados até você assinar um plano em Plano. O mesmo vale para pagamento em atraso ou assinatura cancelada.",
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

  const query = search.trim().toLowerCase();

  const filteredGuides = useMemo(
    () => (query ? GUIDES.filter((g) => g.title.toLowerCase().includes(query) || g.description.toLowerCase().includes(query)) : GUIDES),
    [query]
  );

  const filteredFaq = useMemo(
    () => (query ? FAQ.filter((f) => f.question.toLowerCase().includes(query) || f.answer.toLowerCase().includes(query)) : FAQ),
    [query]
  );

  const nothingFound = query !== "" && filteredGuides.length === 0 && filteredFaq.length === 0;

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-6 sm:px-6 sm:py-10">
      <div className="flex items-start gap-3">
        <span className="mt-1 hidden h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary sm:flex">
          <LifeBuoy className="h-5.5 w-5.5" aria-hidden />
        </span>
        <div>
          <h1 className="text-headline-lg font-extrabold text-graphite">Ajuda e manual de uso</h1>
          <p className="mt-1 text-body-md text-text-muted">Encontre respostas rápidas para configurar e operar seu restaurante.</p>
        </div>
      </div>

      <label className="relative block">
        <span className="sr-only">Pesquisar na ajuda</span>
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-text-muted" aria-hidden />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Pesquise por pedido, caixa, promoção, Pix, pausar loja..."
          className="h-12 w-full rounded-xl border border-border bg-surface-card pl-11 pr-4 text-body-md text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
        />
      </label>

      {!query && hasChecklistSlot}

      {nothingFound && (
        <p className="rounded-xl border border-border bg-surface-subdued/60 px-4 py-6 text-center text-body-md text-text-muted">
          Nada encontrado para &ldquo;{search.trim()}&rdquo;. Tente outra palavra ou fale com o suporte abaixo.
        </p>
      )}

      {filteredGuides.length > 0 && (
        <section aria-labelledby="ajuda-guias">
          <h2 id="ajuda-guias" className="mb-3 text-body-lg font-bold uppercase tracking-wide text-text-muted">
            Guias rápidos
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {filteredGuides.map((guide) => {
              const Icon = guide.icon;
              return (
                <Link key={guide.href} href={guide.href} className="group">
                  <Card className="flex h-full items-start gap-3 p-4 transition-colors group-hover:border-primary/40">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <h3 className="text-body-md font-bold text-graphite">{guide.title}</h3>
                      <p className="mt-0.5 text-body-sm text-text-muted">{guide.description}</p>
                    </span>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {filteredFaq.length > 0 && (
        <section aria-labelledby="ajuda-faq">
          <h2 id="ajuda-faq" className="mb-3 text-body-lg font-bold uppercase tracking-wide text-text-muted">
            Perguntas frequentes
          </h2>
          <Card className="divide-y divide-border overflow-hidden p-0">
            {filteredFaq.map((item) => (
              <details key={item.question} open={query !== "" ? true : undefined} className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-left marker:hidden sm:px-5 [&::-webkit-details-marker]:hidden">
                  <span className="text-label-lg text-graphite">{item.question}</span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-text-muted transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <p className="px-4 pb-4 text-body-md text-text-muted sm:px-5">{item.answer}</p>
              </details>
            ))}
          </Card>
        </section>
      )}

      {(supportEmail || supportWhatsapp) && (
        <Card className="p-5">
          <h2 className="text-body-lg font-bold text-graphite">Precisa de ajuda humana?</h2>
          <p className="mt-1 text-body-md text-text-muted">Fale direto com o suporte do MenuNext.</p>
          <div className="mt-3 flex flex-wrap gap-2.5">
            {supportWhatsapp && (
              <a
                href={`https://wa.me/55${supportWhatsapp}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald px-4 text-label-lg text-white transition-all hover:opacity-90"
              >
                <MessageCircle className="h-4 w-4" aria-hidden />
                Falar no WhatsApp
              </a>
            )}
            {supportEmail && (
              <a
                href={`mailto:${supportEmail}`}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-surface-card px-4 text-label-lg text-graphite hover:bg-surface"
              >
                <Mail className="h-4 w-4" aria-hidden />
                {supportEmail}
              </a>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

import { LinkButton } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import {
  ArrowForwardIcon,
  BoltIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  DevicesIcon,
  PaletteIcon,
  PercentIcon,
  RocketIcon,
  XCircleIcon,
} from "@/components/ui/icons";

const QUICK_BENEFITS = [
  { icon: RocketIcon, title: "Canal Próprio", description: "Sua marca, suas regras" },
  { icon: PercentIcon, title: "0% de Comissão", description: "Sem cortes nos pedidos" },
  { icon: BoltIcon, title: "Pedido Direto", description: "Cliente fala com você" },
  { icon: PaletteIcon, title: "100% Customizável", description: "Cores, logo e produtos" },
  { icon: DevicesIcon, title: "Sem App pra Baixar", description: "Abre direto no link" },
];

const STEPS = [
  {
    number: "01",
    title: "Crie sua loja",
    description:
      "Cadastre seu restaurante em menos de 2 minutos. Defina nome comercial, logotipo, horários e dados para entregas ou retiradas.",
    note: "Tempo estimado: ~2 min",
  },
  {
    number: "02",
    title: "Monte seu cardápio",
    description:
      "Adicione categorias com fotos reais, grupos de adicionais, combos promocionais, tamanhos e observações detalhadas com total autonomia.",
    note: "Importação simples e intuitiva",
  },
  {
    number: "03",
    title: "Publique e venda",
    description:
      "Divulgue seu link no Instagram, WhatsApp e Google Meu Negócio. Receba os pedidos direto no painel com zero intermediários.",
    note: "Pronto para receber pedidos",
  },
];

const MODULES = [
  { title: "Cardápio Digital Interativo", description: "Fotos, variações de tamanhos, grupos de adicionais obrigatórios ou opcionais e combos." },
  { title: "Pedidos em Tempo Real", description: "Alerta sonoro para você nunca perder um pedido. Painel visual em Kanban para agilizar o despacho." },
  { title: "Delivery Próprio & Bairros", description: "Configure taxa fixa, cálculo por bairro atendido ou retirada no balcão sem cobrança de frete." },
  { title: "Pix Automático & Direto", description: "Seu cliente paga com Pix Copia e Cola direto na sua chave, sem intermediários retendo recebíveis." },
  { title: "Cupons & Campanhas", description: "Crie cupons de primeira compra, porcentagem ou desconto fixo para reativar clientes inativos." },
  { title: "Base de Clientes Própria", description: "Nome, telefone, histórico de compras e pratos favoritos de cada cliente que já comprou de você." },
  { title: "Horários de Funcionamento", description: "Abertura e fechamento por turnos, ou botão de pausa de emergência com um clique." },
  { title: "Personalização de Marca", description: "Logotipo, paleta de cores institucional, banner promocional e domínio próprio." },
];

const MENUNEXT_ADVANTAGES = [
  { title: "Sua marca e identidade própria", description: "o cliente compra na sua página sem distrações." },
  { title: "Base de contatos 100% sua", description: "acesso a telefones e e-mails para fazer remarketing." },
  { title: "0% de comissão por venda", description: "o valor total do pedido fica integralmente no seu caixa." },
  { title: "Pix direto na sua conta bancária", description: "sem aguardar dias de repasse." },
  { title: "Sem concorrência na sua vitrine", description: "nenhum cupom de outros restaurantes é exibido." },
];

const MARKETPLACE_DISADVANTAGES = [
  { title: "Comissões abusivas de 12% a 27%", description: "uma fatia pesada que corrói o seu lucro." },
  { title: "O cliente pertence à plataforma", description: "você não tem acesso ao telefone direto do comprador." },
  { title: "Concorrentes patrocinados", description: "restaurantes vizinhos pagam para aparecer no seu perfil." },
  { title: "Guerra constante por descontos", description: "desvalorização do seu produto para figurar no topo." },
  { title: "Repasses atrasados", description: "fluxos demorados que prejudicam seu capital de giro." },
];

const PLANS = [
  {
    name: "Plano Start",
    tagline: "Início",
    description: "Perfeito para pequenos negócios, marmitarias e quem está começando a digitalizar as vendas.",
    price: "R$ 39,90",
    cta: "Começar no Start",
    highlighted: false,
    features: [
      "Até 100 pedidos por mês",
      "Cardápio digital ilimitado",
      "Recebimento de Pix direto",
      "Link personalizado para redes sociais",
      "Suporte via WhatsApp",
    ],
  },
  {
    name: "Plano Pro",
    tagline: "Recomendado",
    description: "O pacote completo para hamburguerias, pizzarias e cozinhas com delivery ativo diário.",
    price: "R$ 69,90",
    cta: "Experimentar 30 dias grátis",
    highlighted: true,
    features: [
      "Pedidos ilimitados (0% comissão)",
      "Taxas de entrega personalizadas por bairro",
      "Painel Kanban sonoro em tempo real",
      "Cupons de desconto e combos promocionais",
      "Impressão automática de comandas de cozinha",
      "QR Codes de mesa e balcão prontos para imprimir",
      "Suporte prioritário via WhatsApp",
    ],
  },
  {
    name: "Plano Plus",
    tagline: "Escala",
    description: "Para restaurantes com múltiplos atendentes, alto volume de expedição e dark kitchens.",
    price: "R$ 119,90",
    cta: "Assinar o Plus",
    highlighted: false,
    features: [
      "Tudo o que está incluído no Pro",
      "Múltiplos usuários e perfis de atendentes",
      "Relatórios avançados e exportação contábil",
      "Domínio próprio configurado",
      "Gerente de conta VIP dedicado",
    ],
  },
];

const FAQ_ITEMS = [
  {
    question: "Preciso instalar algum aplicativo?",
    answer:
      "Não! O MenuNext funciona 100% no navegador, tanto no celular quanto em computadores, notebooks ou tablets. Você e sua equipe não precisam baixar nada, e seus clientes abrem o cardápio num piscar de olhos.",
  },
  {
    question: "Meus clientes precisam criar uma conta ou senha?",
    answer:
      "Não! Seu cliente acessa o link, escolhe os pratos, adiciona itens extras, digita o endereço e conclui a compra sem cadastro.",
  },
  {
    question: "Existe cobrança de comissão por cada pedido?",
    answer:
      "Zero comissão. Você paga apenas o valor mensal fixo da sua assinatura, independentemente do volume de pedidos.",
  },
  {
    question: "Posso personalizar a loja com a identidade do meu restaurante?",
    answer: "Sim! Logotipo, banner de capa, cores predominantes, bio descritiva e organização das categorias.",
  },
  {
    question: "Posso trabalhar com entrega (delivery) e retirada no local?",
    answer: "Sim! O sistema permite ativar Delivery (taxa fixa ou por bairro) e Retirada no Balcão.",
  },
  {
    question: "Como funciona o pagamento por Pix?",
    answer:
      "Você cadastra sua própria chave Pix no painel. O cliente recebe o código Copia e Cola e o valor cai direto na sua conta.",
  },
  {
    question: "Como funciona o período de teste grátis?",
    answer: "30 dias de acesso gratuito completo, sem pedir cartão de crédito no cadastro.",
  },
];

export default function FanpagePage() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="border-b border-border bg-surface">
          <div className="mx-auto grid max-w-[1440px] gap-12 px-6 py-16 md:grid-cols-2 md:items-center md:py-24">
            <div className="space-y-6">
              <Badge tone="warning">O SaaS completo para vender direto sem taxas abusivas</Badge>
              <h1 className="text-4xl font-extrabold leading-tight text-graphite md:text-5xl">
                Seu restaurante.
                <br />
                Seu cardápio.
                <br />
                Seus pedidos.
              </h1>
              <p className="max-w-lg text-base text-text-muted">
                Crie sua loja online personalizada, receba pedidos em tempo real direto dos seus clientes e livre
                sua operação da dependência de marketplaces caros.
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <LinkButton href="/cadastro" size="lg">
                  <RocketIcon className="h-5 w-5" />
                  Criar minha loja grátis
                </LinkButton>
                <a href="#como-funciona" className="text-sm font-semibold text-graphite hover:text-primary">
                  ▶ Ver como funciona
                </a>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium text-text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircleIcon className="h-4 w-4 text-emerald" /> 30 dias grátis
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircleIcon className="h-4 w-4 text-emerald" /> Sem cartão de crédito
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircleIcon className="h-4 w-4 text-emerald" /> 0% de comissão
                </span>
              </div>
            </div>

            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-graphite">Next Burger • Delivery</p>
                  <p className="text-xs text-text-muted">Painel Operacional</p>
                </div>
                <Badge tone="success" pulse>
                  Loja Aberta
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-surface-subdued p-3">
                  <p className="text-xs text-text-muted">Faturamento Hoje</p>
                  <p className="text-lg font-bold text-graphite">R$ 1.248,00</p>
                  <p className="text-xs font-semibold text-emerald">+18% vs ontem</p>
                </div>
                <div className="rounded-lg bg-surface-subdued p-3">
                  <p className="text-xs text-text-muted">Pedidos Ativos</p>
                  <p className="text-lg font-bold text-graphite">4 em preparo</p>
                  <p className="text-xs text-text-muted">Tempo médio: 24 min</p>
                </div>
              </div>
              <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
                <p className="text-xs font-semibold text-primary">Novo pedido #1048 recebido</p>
                <p className="text-xs text-text-muted">R$ 54,80 • Pix confirmado instantâneo</p>
              </div>
            </Card>
          </div>
        </section>

        <section className="border-b border-border bg-surface-card">
          <div className="mx-auto grid max-w-[1440px] grid-cols-2 gap-6 px-6 py-10 md:grid-cols-5">
            {QUICK_BENEFITS.map((benefit) => (
              <div key={benefit.title} className="flex flex-col items-center gap-2 text-center">
                <benefit.icon className="h-6 w-6 text-primary" />
                <p className="text-sm font-semibold text-graphite">{benefit.title}</p>
                <p className="text-xs text-text-muted">{benefit.description}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="como-funciona" className="mx-auto max-w-[1440px] px-6 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-extrabold text-graphite">Processo Rápido &amp; Sem Complicações</h2>
            <p className="mt-3 text-text-muted">
              Do cardápio ao primeiro pedido em poucos minutos. Criado para donos de restaurantes que não querem
              perder tempo com burocracias técnicas.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {STEPS.map((step) => (
              <Card key={step.number} className="p-6">
                <span className="text-sm font-extrabold text-primary">{step.number}</span>
                <h3 className="mt-2 text-lg font-bold text-graphite">{step.title}</h3>
                <p className="mt-2 text-sm text-text-muted">{step.description}</p>
                <p className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald">
                  <CheckCircleIcon className="h-4 w-4" /> {step.note}
                </p>
              </Card>
            ))}
          </div>
        </section>

        <section id="recursos" className="border-y border-border bg-surface-card">
          <div className="mx-auto max-w-[1440px] px-6 py-20">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-extrabold text-graphite">Módulos Estratégicos</h2>
              <p className="mt-3 text-text-muted">
                Tudo o que seu negócio gastronômico precisa para crescer, pensado para a rotina dinâmica da operação
                de alimentos.
              </p>
            </div>
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {MODULES.map((module) => (
                <Card key={module.title} className="p-5">
                  <h3 className="text-sm font-bold text-graphite">{module.title}</h3>
                  <p className="mt-2 text-xs text-text-muted">{module.description}</p>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[1440px] px-6 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-extrabold text-graphite">
              Você não precisa dividir seu lucro com marketplaces.
            </h2>
            <p className="mt-3 text-text-muted">
              Nos grandes aplicativos de entrega você é apenas mais uma opção disputando preço com dezenas de
              concorrentes. Com o MenuNext, a marca e o cliente são seus.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-2">
            <Card className="border-emerald/30 bg-[#ECFDF5]/40 p-6">
              <p className="text-sm font-semibold text-emerald">Com o MenuNext</p>
              <h3 className="mt-1 text-lg font-bold text-graphite">Canal próprio de alta conversão</h3>
              <ul className="mt-4 space-y-3">
                {MENUNEXT_ADVANTAGES.map((item) => (
                  <li key={item.title} className="flex gap-2 text-sm">
                    <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald" />
                    <span>
                      <span className="font-semibold text-graphite">{item.title}:</span>{" "}
                      <span className="text-text-muted">{item.description}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="border-red/20 bg-[#FEF2F2]/40 p-6">
              <p className="text-sm font-semibold text-red">Marketplaces Tradicionais</p>
              <h3 className="mt-1 text-lg font-bold text-graphite">Intermediação e perda de margem</h3>
              <ul className="mt-4 space-y-3">
                {MARKETPLACE_DISADVANTAGES.map((item) => (
                  <li key={item.title} className="flex gap-2 text-sm">
                    <XCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-red" />
                    <span>
                      <span className="font-semibold text-graphite">{item.title}:</span>{" "}
                      <span className="text-text-muted">{item.description}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </section>

        <section id="planos" className="border-y border-border bg-surface-card">
          <div className="mx-auto max-w-[1440px] px-6 py-20">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-extrabold text-graphite">Escolha o plano que combina com seu restaurante.</h2>
              <p className="mt-3 text-text-muted">
                Sem taxas ocultas, sem fidelidade e com 30 dias grátis para testar na prática.
              </p>
            </div>
            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {PLANS.map((plan) => (
                <Card
                  key={plan.name}
                  className={`relative flex flex-col p-6 ${plan.highlighted ? "border-primary shadow-[0_8px_20px_-4px_rgba(249,87,33,0.25)]" : ""}`}
                >
                  {plan.highlighted && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-bold text-white">
                      MAIS ESCOLHIDO
                    </span>
                  )}
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{plan.tagline}</p>
                  <h3 className="mt-1 text-xl font-extrabold text-graphite">{plan.name}</h3>
                  <p className="mt-2 text-sm text-text-muted">{plan.description}</p>
                  <p className="mt-4">
                    <span className="text-3xl font-extrabold text-graphite">{plan.price}</span>
                    <span className="text-sm text-text-muted">/mês</span>
                  </p>
                  <ul className="mt-5 flex-1 space-y-2.5">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex gap-2 text-sm text-text-muted">
                        <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <LinkButton href="/cadastro" variant={plan.highlighted ? "primary" : "secondary"} className="mt-6 w-full">
                    {plan.cta}
                  </LinkButton>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="mx-auto max-w-[1440px] px-6 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-extrabold text-graphite">Perguntas Frequentes</h2>
            <p className="mt-3 text-text-muted">
              Tudo o que você precisa saber para começar a usar o MenuNext hoje mesmo.
            </p>
          </div>
          <div className="mx-auto mt-10 max-w-3xl divide-y divide-border rounded-xl border border-border bg-surface-card">
            {FAQ_ITEMS.map((item) => (
              <details key={item.question} className="group px-6 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-graphite">
                  {item.question}
                  <ChevronDownIcon className="h-4 w-4 shrink-0 text-text-muted transition-transform group-open:rotate-180" />
                </summary>
                <p className="mt-3 text-sm text-text-muted">{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="bg-graphite">
          <div className="mx-auto max-w-[1440px] px-6 py-20 text-center">
            <p className="text-xs font-bold uppercase tracking-widest text-primary">Comece Hoje Mesmo</p>
            <h2 className="mt-3 text-3xl font-extrabold text-white md:text-4xl">
              Seu restaurante já tem clientes.
              <br />
              Agora tenha seu próprio canal de vendas.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-white/70">
              Crie sua loja online no MenuNext em menos de 5 minutos e comece a receber pedidos diretamente pelo
              WhatsApp e web com 100% do lucro no seu caixa.
            </p>
            <LinkButton href="/cadastro" size="lg" className="mt-8">
              Criar minha loja grátis
              <ArrowForwardIcon className="h-5 w-5" />
            </LinkButton>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

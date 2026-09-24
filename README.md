# MenuNext

> Seu restaurante. Sua loja. Seus pedidos.

SaaS B2B multi-tenant para restaurantes: cardápio digital, checkout próprio (Pix/dinheiro/cartão) e painel operacional, sem comissão por pedido.

**Stack:** Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS 4; Supabase (Postgres + Auth + Storage, com RLS) como backend; Sentry para monitoramento de erros; Vitest para testes unitários.

## Desenvolvimento

```bash
cp .env.example .env.local   # preencher com as credenciais do projeto Supabase (ver seção abaixo)
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

Outros scripts: `npm run build`, `npm run lint`, `npm test`.

## Banco de dados

Todo o schema (tabelas, RLS, RPCs) vive em `supabase/migrations/` — esse diretório é a fonte de verdade do estado do banco em produção; qualquer alteração de schema deve ser adicionada ali como uma nova migration (nunca aplicada só em produção sem o arquivo correspondente).

## Funcionalidades principais

- **Cadastro/login** com CPF ou CNPJ obrigatório (trial de 30 dias, 1 documento = 1 trial).
- **Onboarding guiado** (7 passos) + checklist de configuração reaproveitável no painel.
- **Loja pública** (`/loja/[slug]`): cardápio com categorias/adicionais/combos, carrinho, checkout e acompanhamento do pedido — sem exigir login do cliente final.
- **Painel do lojista** (`/painel`): pedidos (Kanban em tempo real), cozinha (KDS), cadastro de produtos/categorias/adicionais/combos, configuração de delivery/horários/pagamentos/aparência, equipe (convites de STAFF) e mais.
- **Painel administrativo** (`/master`) — bootstrap inicial; ainda sem controle de acesso real por papel (item conhecido em aberto).

Billing/assinatura, cupons/marketing e frente de caixa (PDV) ainda não foram implementados — dependem de decisões de produto/infra em aberto.

## Estrutura

- `src/app` — rotas (App Router): fanpage (`/`), `/cadastro`, `/onboarding`, `/convite/[token]` (aceite de convite de equipe), `/loja/[slug]` (loja pública), `/painel` (lojista), `/master` (administração da plataforma).
- `src/lib` — acesso a dados (`tenant.ts`, `store.ts`), Server Actions (`lib/actions/`) e regras de negócio puras testadas em `*.test.ts`.
- `src/components/ui` — primitivos (Button, Badge, Card, Modal, estados de loading/vazio/erro).
- `src/components/layout` — sidebar (com menu mobile), topbar e banner de impersonation do Master.
- `src/components/scaffold` — placeholder usado nas rotas ainda não implementadas visualmente.
- `supabase/migrations` — schema do banco (ver seção acima).
- `design-reference/stitch` — export original do Stitch, preservado como referência visual (ver `design-reference/README.md` para o mapa tela → rota).

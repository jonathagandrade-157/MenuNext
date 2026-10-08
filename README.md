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

### Variáveis de ambiente

Ver `.env.example` (todas comentadas). Só as duas do Supabase são obrigatórias:

- `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` — projeto Supabase.
- `GOOGLE_MAPS_GEOCODING_API_KEY` — opcional; sem ela o frete "Por KM" fica indisponível e a taxa fixa continua funcionando.
- `ASAAS_API_KEY` e `ASAAS_ENV` (`sandbox` por padrão, ou `production`) — opcionais; sem a chave, "Assinar plano" mostra um aviso em vez de fingir sucesso. Nunca prefixar com `NEXT_PUBLIC_`.

### Cobrança (Asaas)

A assinatura do lojista é cobrada pelo Asaas (o pedido do cliente final continua sendo Pix direto, sem gateway). Para operar:

1. Defina `ASAAS_API_KEY` (comece pelo sandbox).
2. Crie os planos em `/master/assinaturas` (nome e valor reais, nada é semeado).
3. Gere um token aleatório de 32 a 255 caracteres, salve-o em `/master/assinaturas` e configure o **mesmo** valor no webhook do Asaas (Integrações → Webhooks → Token de acesso), apontando para `https://<seu-domínio>/api/webhooks/asaas`. Sem token salvo, nenhum webhook é aceito.

### Testes

`npm test` roda o Vitest. Os testes cobrem a lógica pura de `src/lib/` (módulos testados usam import relativo, porque o Vitest do projeto não resolve o alias `@/`). Server Actions ainda não têm teste automatizado.

**Isolamento entre restaurantes (banco):** `supabase/tests/tenant_isolation.sql` verifica RLS e RPCs com quatro personas (dono da loja A, usuário sem loja, master fora da loja e visitante anônimo): ninguém lê nem altera dados de outra loja, o master só enxerga lojas alheias pelas RPCs `master_*`, e o checkout público recusa produto de outra loja. Cole o arquivo no SQL Editor do Supabase; ele roda numa transação que sempre é desfeita e o relatório vem na mensagem final (`RESULTADO: OK | N verificacoes` ou `RESULTADO: FALHOU ...`). Rode-o depois de qualquer mudança em policies ou RPCs. Ele ainda não roda no CI, que não tem banco.

## Banco de dados

Todo o schema (tabelas, RLS, RPCs) vive em `supabase/migrations/` — esse diretório é a fonte de verdade do estado do banco em produção; qualquer alteração de schema deve ser adicionada ali como uma nova migration (nunca aplicada só em produção sem o arquivo correspondente).

## Funcionalidades principais

- **Cadastro/login** com CPF ou CNPJ obrigatório (trial de 30 dias, 1 documento = 1 trial).
- **Onboarding guiado** (7 passos) + checklist de configuração reaproveitável no painel.
- **Loja pública** (`/loja/[slug]`): cardápio com categorias/adicionais/combos, carrinho, checkout e acompanhamento do pedido — sem exigir login do cliente final.
- **Painel do lojista** (`/painel`): dashboard, pedidos (Kanban em tempo real), cozinha (KDS), frente de caixa (PDV), cadastro de produtos/categorias/adicionais/combos, cupons e marketing, clientes, configuração de delivery (inclui zonas por bairro)/horários/pagamentos/aparência, equipe (convites de STAFF), plano e assinatura, e ajuda.
- **Cobrança e acesso:** trial de 30 dias no cadastro; depois dele, assinatura de um plano via Asaas. Sem plano após o trial, com pagamento atrasado ou com assinatura cancelada, o painel **e** a loja pública ficam bloqueados (só `/painel/plano` continua acessível para regularizar). A regra vive no banco (função `_restaurant_access_state`) e vale também no `create_order`.
- **Painel administrativo** (`/master`): acesso restrito a quem tem `profiles.is_master` (só concedível pelo editor SQL do Supabase). Telas reais: dashboard da plataforma, restaurantes (lista e detalhe), assinaturas (planos e token do webhook) e configurações. **Ainda em branco:** Usuários, Métricas, Suporte e Auditoria.

## Estrutura

- `src/app` — rotas (App Router): fanpage (`/`), `/cadastro`, `/onboarding`, `/convite/[token]` (aceite de convite de equipe), `/loja/[slug]` (loja pública), `/painel` (lojista), `/master` (administração da plataforma).
- `src/lib` — acesso a dados (`tenant.ts`, `store.ts`), Server Actions (`lib/actions/`) e regras de negócio puras testadas em `*.test.ts`.
- `src/components/ui` — primitivos (Button, Badge, Card, Modal, estados de loading/vazio/erro).
- `src/components/layout` — sidebar (com menu mobile), topbar e banner de impersonation do Master.
- `src/components/scaffold` — placeholder usado nas rotas ainda não implementadas visualmente.
- `supabase/migrations` — schema do banco (ver seção acima).
- `design-reference/stitch` — export original do Stitch, preservado como referência visual (ver `design-reference/README.md` para o mapa tela → rota).

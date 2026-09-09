# MenuNext

> Seu restaurante. Sua loja. Seus pedidos.

SaaS B2B multi-tenant para restaurantes (Next.js + React + TypeScript + Tailwind CSS; Supabase/PostgreSQL a partir da Sprint 1).

## Desenvolvimento

```bash
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

## Estrutura

- `src/app` — rotas (App Router): fanpage (`/`), `/cadastro`, `/onboarding`, `/loja/[slug]` (loja pública), `/painel` (lojista), `/master` (administração da plataforma).
- `src/components/ui` — primitivos (Button, Badge, Card, estados de loading/vazio/erro).
- `src/components/layout` — sidebar, topbar e banner de impersonation do Master.
- `src/components/scaffold` — placeholder usado nas rotas ainda não implementadas visualmente.
- `design-reference/stitch` — export original do Stitch, preservado como referência visual (ver `design-reference/README.md` para o mapa tela → rota).

## Status

Sprint 0 (bootstrap): estrutura de rotas e design tokens oficiais criados; fanpage implementada; demais telas com placeholder aguardando as próximas Sprints. Autenticação, multi-tenant real, banco de dados e pagamentos ainda não foram implementados.

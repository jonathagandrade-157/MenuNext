# Laboratório local de testes HTTP (PostgreSQL + PostgREST)

Serve para provar, **sem tocar em produção**, o que o PostgREST (a API pública do Supabase) deixa ou não executar com
cada chave. Tudo roda em `127.0.0.1`, com banco, usuários, JWTs e segredos **sintéticos** gerados na hora. Nada daqui vai
para o repositório.

1. Um PostgreSQL 17 descartável (pacote `embedded-postgres`) recebe **todas** as migrations de `supabase/migrations/`.
2. O PostgREST oficial (`PostgREST/postgrest`, release `v16.5`, `windows-x86-64`) fica numa pasta **fora do repositório**.
   Confira sempre o SHA-256 do arquivo com o *digest* publicado na página da release no GitHub
   (`17f595b0d8dd37473d0231417dea07c5ac9f791282ff5b017fae51ff29e5de2f` para a v16.5 Windows). Não use binário de outra origem.
3. Um gateway mínimo mapeia `/rest/v1/*` para o PostgREST (sem GoTrue: o login é simulado pelos testes).
4. Testes: `node checkout-http.mjs` (HTTP puro, 22 verificações) e
   `CHECKOUT_LAB_STATE=<lab-state.json> npx vitest run src/integration/checkout.lab.test.ts` (código real das Server
   Actions contra o banco real do laboratório, 8 verificações). Reinicie o laboratório antes de cada rodada: os testes
   semeiam a própria loja e contam limites reais.

Limites do laboratório: não é o Supabase (sem GoTrue, sem Storage, sem Realtime, codificação WIN1252), portanto prova
permissões e regras do banco e da camada de ações, **não** o comportamento da plataforma em produção.

# Checkout em PostgreSQL 17 descartavel

`node scripts/checkout-lab/run.mjs` cria um cluster vazio, aplica as migrations do repositorio e executa as suites SQL
de `supabase/tests` que existirem (promocoes, caixa, protecao do checkout, limites, OWNER/STAFF) com dados sinteticos.
Quando as migrations `20261027010000` e `20261027020000` existirem no repositorio, cada uma e aplicada separadamente e os
privilegios de `create_order`/`create_counter_order` sao conferidos entre elas; sem elas, confere so o estado atual
(`create_order` executavel por anon/authenticated).
O cluster escuta somente em 127.0.0.1:55432 e e removido ao terminar. Nao aceita URL, senha nem projeto remoto.
Exige PostgreSQL 17 nativo (`CHECKOUT_PG_BIN` aponta para os binarios), usuario sem privilegios de root e porta livre.

O CI executa esse laboratorio na nuvem, sem Docker ou WSL. O bootstrap simula os schemas `auth`/`storage`, os roles e
a publicacao do Realtime para exercitar SQL/RLS; nao executa GoTrue, PostgREST, Storage HTTP ou Realtime reais.
Os checks intermediarios provam dependencias e privilegios SQL, nao que uma versao do aplicativo foi implantada.

Sequencia a homologar na plataforma: migration 1 -> aplicativo com RPC de PDV e credencial de servidor -> migration 2.
Depois da migration 2, reverter apenas o aplicativo quebra checkout/cupom/promocoes/cadastro; o rollback exige restaurar
os privilegios anteriores sob controle ou manter o aplicativo compativel. Antes da migration 1 o novo PDV nao funciona.

Este laboratorio NAO aprova backup de producao, migrations de producao ou acesso funcional no Supabase hospedado.
A homologacao real precisa de projeto Supabase separado, dados sinteticos, variaveis isoladas no Preview e acesso Vercel
autenticado. Nao conecte o Preview ao banco de producao.

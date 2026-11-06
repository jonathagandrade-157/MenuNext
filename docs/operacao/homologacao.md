# Roteiro de homologação das mudanças pendentes

**Para quê:** reunir, num lugar só, o que precisa ser provado em um ambiente Supabase/Vercel **separado da produção** antes de
integrar as PRs que dependem de migrations. Nada aqui foi executado em produção. O laboratório do CI (PostgreSQL 17 sintético)
prova SQL, RLS e concorrência; **não prova** Auth, PostgREST, Storage, Realtime nem a plataforma hospedada.

## Regras
- Ambiente de homologação com projeto Supabase **próprio**, variáveis isoladas no Preview Vercel e dados sintéticos. Nunca apontar o Preview para o banco de produção.
- Uma migration por vez, na ordem abaixo, com pré-voo (objetos existentes, contagens) e pós-voo (suítes SQL + conferência de privilégios) antes da seguinte.
- Backup de produção segue **não aprovado**; nenhuma migration vai à produção sem backup e aprovação do dono.

## Ordem e dependências

| Ordem | Migration | PR | Depende de | Risco principal |
|---|---|---|---|---|
| 1 | `20261027010000_checkout_counter_wrapper_and_flood_guard` | #7 | — | **NO-GO** até homologar; o PDV novo exige esta função |
| 2 | (aplicativo) checkout pelo servidor | #6 | `SUPABASE_SERVICE_ROLE_KEY` no servidor | sem a chave o pedido online fica indisponível |
| 3 | `20261027020000_revoke_public_checkout_rpcs` | #7 | 1 e 2 implantados | **quebra o checkout atual** se vier antes do app #6; voltar só o app depois dela também quebra |
| 4 | `20261105000000_stock_ledger` | #9 | — | aditiva |
| 5 | `20261105010000_cash_movements` | #13 | caixa atual (`20261024020000`) | **redefine `cash_current` e `cash_close`** (mesma assinatura) |
| 6 | `20261105020000_support_tickets` | #14 | — | aditiva |
| 7 | `20261105030000_stock_order_integration` | #15 | 4 | **gatilhos em `order_items` e `orders`** (inertes com a baixa desligada) |
| 8 | `20261105040000_product_variants` | #16 | — | aditiva (só cadastro; sem uso na loja/checkout) |
| 9 | `20261106000000_cash_session_sales` | #18 | 5 | somente leitura |

PRs sem migration: #12 (pedidos ao vivo), #20 (aviso no navegador), #19 (relatório de estoque; precisa das migrations 4 e 7 para ter dados).

## Verificações por migration (além das suítes SQL)

- **Checkout (1–3):** pedido online com cupom e promoção; idempotência (repetir a mesma chave); pedido de balcão pelo PDV; chamada direta `POST /rest/v1/rpc/create_order` com a chave pública deve falhar **depois** da migration 3; limites de tentativas (mensagem amigável). Ver `smoke-test-beta.md`.
- **Caixa (5, 9):** abrir caixa; vender no balcão em dinheiro/Pix/cartão; suprimento e sangria; fechar com valor contado diferente do esperado; conferir que o esperado = abertura + dinheiro + suprimentos − sangrias; STAFF registra, só OWNER vê sessões fechadas. **Comparar `cash_current`/`cash_close` antes e depois da migration 5 numa sessão sem movimentações: o resultado deve ser idêntico.**
- **Estoque (4, 7):** cadastrar saldo; baixa manual; ligar a baixa automática e fazer pedidos reais de teste; cancelar e conferir o estorno; pedir acima do saldo. **Medir a latência de `create_order` com os gatilhos (ligados e desligados)** — é o único ponto de custo no caminho de venda.
- **Suporte (6):** OWNER abre chamado; plataforma responde/muda status; STAFF e outra loja não enxergam.
- **Variantes (8):** criar/editar/desativar; confirmar que a loja pública **não** muda.
- **Pedidos ao vivo (#12) e aviso no navegador (#20):** derrubar a rede/aba e confirmar reconexão, ausência de som duplicado e contador no título; testar permissão negada e aba em segundo plano em navegadores de desktop e celular.
- **Relatórios e CSV (#11 já integrada, #19):** período de 1 dia e de 366 dias; abrir o CSV no Excel pt-BR; conferir totais com o painel.

## Rollback (testado só em PostgreSQL sintético)

`supabase/rollback/*.down.sql` desfaz cada migration nova (**não** fica em `supabase/migrations`, para nunca ser aplicado por engano). O laboratório
(`scripts/checkout-lab/rollback.mjs`) aplica todas as migrations, executa os rollbacks do mais novo ao mais antigo, confere que não sobrou
tabela, função nem gatilho, e **reexecuta as suítes originais** (caixa, papéis, isolamento, promoções, privilégios).

- Rollback apaga **os dados** das tabelas novas (estoque, chamados, variantes, movimentações do caixa). Exportar antes se precisar.
- O rollback do estoque × pedidos remove as linhas de venda/estorno do livro, **mas não recalcula** o saldo em `stock_items`.
- O rollback da migration 5 restaura `cash_current` e `cash_close` originais (copiados da migration `20261024020000`).
- **Não existe rollback para as migrations 1 e 3**: o plano é manter o aplicativo compatível ou restaurar os privilégios sob controle (ver README do laboratório).

## O que o CI já prova (e o que não)
Prova: migrations em ordem de nome no PostgreSQL 17, ~1.470 verificações SQL (incluindo isolamento entre lojas, privilégios, concorrência com 16 sessões e rollback), lint, tipos, build e testes de unidade.
Não prova: comportamento no Supabase hospedado, pool de conexões, Realtime, Storage, Vercel, carga, navegadores reais, e-mail.

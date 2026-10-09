# Colunas de cobrança de `restaurants` — regras de manutenção

A tabela `public.restaurants` tem cinco colunas que controlam o acesso pago à plataforma:

`plan_id`, `subscription_status`, `asaas_customer_id`, `asaas_subscription_id`, `subscription_current_period_end`.

Elas só podem ser alteradas por funções `SECURITY DEFINER` do banco (hoje `start_restaurant_subscription` e
`process_asaas_webhook`), nunca por um `update` direto vindo da aplicação ou da API.

## Como isso é garantido

Migration `20261009000000_protect_restaurant_billing_columns.sql`:

1. `authenticated` e `anon` **não** têm `UPDATE` na tabela inteira; só nas colunas operacionais listadas explicitamente.
2. O trigger `restaurants_guard_billing_columns` barra qualquer mudança nas cinco colunas de cobrança quando quem
   executa é `anon` ou `authenticated`. É uma segunda camada: vale mesmo que alguém reabra um `GRANT` por engano.

## Regras ao mexer em `restaurants`

1. **Coluna nova.** Classifique-a em `supabase/tests/restaurant_billing_columns.sql` (listas de colunas operacionais, de
   cobrança e de sistema). O teste falha enquanto houver coluna sem classificação. Se o lojista pode editá-la, conceda só
   essa coluna: `grant update (coluna) on public.restaurants to authenticated;`.
2. **Nunca** execute `grant update on public.restaurants ...` (tabela inteira) para `authenticated` ou `anon`.
3. **Nunca** conceda `UPDATE` das colunas de cobrança a `authenticated` ou `anon`.
4. Se uma tela falhar com `permission denied` numa coluna operacional, a correção é conceder aquela coluna (item 1), não
   reabrir a tabela.
5. Rode o teste `restaurant_billing_columns.sql` **só em banco isolado** (ele cria usuários em `auth.users`); nunca contra a
   produção. Rode também `tenant_isolation.sql` depois de qualquer mudança em políticas ou RPCs.
6. O procedimento detalhado de recuperação desta correção é mantido em documentação **privada**, fora deste repositório
   público. Peça ao responsável pelo projeto se for necessário.

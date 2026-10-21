# Cobrança de assinaturas — modelo e regras de manutenção

Este documento descreve como a assinatura do lojista libera (ou não) o acesso pago ao MenuNext e o que não pode ser
quebrado ao mexer nesse fluxo. Migration de referência: `20261009010000_secure_subscription_billing.sql`.

## Princípio

**Acesso pago só existe depois de um pagamento confirmado pela API autenticada do provedor.** Nada que o lojista (OWNER ou
STAFF) ou o navegador enviar libera acesso: nem o status, nem o plano, nem os IDs do provedor.

## Modelo

| Peça | Papel |
|---|---|
| `billing_subscriptions` | Uma linha por assinatura. Guarda **provedor**, plano, **valor e moeda fixados pelo banco** a partir do plano, IDs do provedor, status (`initiated`, `pending`, `active`, `overdue`, `cancelled`), fim do período pago e bloqueio administrativo. |
| `billing_payments` | Uma linha por cobrança (também com o provedor). O status da assinatura é **derivado** do conjunto de cobranças. |
| `asaas_webhook_events` | Livro-razão dos eventos recebidos: idempotência por `(provider, id do evento)` e resultado de cada um. |
| `restaurants.plan_id`, `subscription_status`, `asaas_*` | Espelho para telas e métricas. Só funções do banco escrevem. |

As tabelas de cobrança não têm política nem privilégio para `anon`/`authenticated`: só funções `SECURITY DEFINER` as tocam.

## Quem pode o quê

| Operação | Quem | Observação |
|---|---|---|
| `billing_begin_subscription` | OWNER (sessão do lojista) | O banco escolhe restaurante, plano ativo, valor e moeda. Idempotente. Não libera acesso. |
| `billing_attach_provider_subscription` | **Só o backend** (`service_role`) | O servidor leu a assinatura na API do Asaas e conferiu cliente, valor, status e referência; o banco exige que o valor conferido bata com o do plano. O lojista nunca envia IDs. |
| `process_asaas_webhook` | `anon` com o token do webhook | Antes, a rota confere o token e, para eventos de confirmação, lê a cobrança na API do Asaas. |
| `billing_reconcile_*`, `billing_list_reconcilable` | **Só o backend** (`service_role`) | Usados pela rotina agendada `/api/cron/billing-reconcile`. |
| `master_set_billing_block` | Master | Bloqueio administrativo (fraude ou decisão administrativa), com motivo. |

## Regras de acesso (`_restaurant_access_state`)

- Assinatura `active`: acesso liberado.
- `pending` (ou sem cobrança confirmada): **não libera**. A loja segue regida pelo teste gratuito e pelas cortesias do Master.
- `overdue` (já foi paga e uma cobrança venceu): bloqueio total.
- `cancelled` (já foi paga): **mantém o acesso até o fim do período já pago** e bloqueia depois (calculado na leitura, sem job).
- Bloqueio administrativo vence tudo e é imediato.
- Assinatura que nunca foi paga e é cancelada ou fica em atraso **não** derruba o teste gratuito em curso.

## Cobranças: transições, duplicidade e ordem

- O estado de cada cobrança segue uma **tabela explícita de transições** (`_billing_payment_may_transition`), não uma ordem numérica.
  Transições que "voltam atrás" (disputa de chargeback ganha, vencimento prorrogado, cobrança restaurada) só valem com um evento
  comprovadamente **mais novo** (horário do próprio evento do provedor).
- `PAYMENT_CONFIRMED` e `PAYMENT_RECEIVED` da mesma cobrança são a mesma cobrança: o período pago é o do **maior vencimento
  confirmado**, nunca a soma.
- Estorno, chargeback e exclusão removem o período correspondente.
- Evento repetido (mesmo id) é ignorado; evento que chega antes do registro dos IDs fica guardado e é reaplicado.
- `cancelled` é terminal: pagamento posterior não ressuscita a assinatura (é preciso assinar de novo).

## Reconciliação (webhook não entregue)

`/api/cron/billing-reconcile` roda uma vez por dia (`vercel.json`), exige `Authorization: Bearer <CRON_SECRET>` e lê cada
assinatura viva (e as canceladas nos últimos 60 dias) e suas cobranças na API do Asaas. A leitura é a **verdade naquele
instante**: recupera pagamentos e cancelamentos perdidos e corrige confirmações indevidas. Em planos da Vercel que permitam,
use uma frequência maior.

## Regras ao mexer neste fluxo

1. **Nunca** conceda privilégio nas tabelas `billing_*` a `anon`/`authenticated` e nunca adicione política a elas.
2. **Nunca** conceda `EXECUTE` de `billing_attach_provider_subscription` ou `billing_reconcile_*` a `anon`/`authenticated`, nem de
   `process_asaas_webhook` a `authenticated`, nem de `_billing_*` / `_restaurant_access_state` a `anon`/`authenticated`.
3. **Nunca** faça o acesso depender de `plan_id` ou de `subscription_status` em `restaurants`: o espelho não é fonte de verdade.
4. A chave de servidor do Supabase (`SUPABASE_SERVICE_ROLE_KEY`) só é usada em `src/lib/supabase/admin.ts`, nunca no navegador,
   e apenas para as RPCs de cobrança acima.
5. O **efeito** de cada evento do provedor é decidido no banco (mapeamento em `process_asaas_webhook`); o código Next.js só
   normaliza o payload e confere a cobrança na API. Não passe status pronto vindo do cliente.
6. **Novo provedor** (por exemplo Pix): amplie o `check` de `billing_subscriptions.provider`, crie uma função de webhook própria
   com a autenticação do provedor e reutilize `_billing_apply_core`. Cada assinatura, cobrança e evento continua guardando o
   provedor de origem, então trocar o provedor ativo não reescreve o histórico.
7. Rode `supabase/tests/billing_subscriptions.sql`, `restaurant_billing_columns.sql` e `tenant_isolation.sql` **só em banco
   isolado** (criam usuários em `auth.users`) depois de qualquer mudança aqui. O roteiro com o Asaas Sandbox está em
   [asaas-sandbox-e2e.md](../asaas-sandbox-e2e.md).
8. O procedimento detalhado de recuperação é mantido em documentação **privada**, fora deste repositório público.

# Teste ponta a ponta com o Asaas Sandbox

Roteiro para validar a cobrança de assinaturas contra o **sandbox** do Asaas, **sem pagamentos reais**. Faça em um ambiente
isolado (Preview da Vercel ou máquina local com túnel), com um projeto Supabase de teste, nunca na produção.

## 0. Pré-requisitos

| Item | Valor |
|---|---|
| Conta | `https://sandbox.asaas.com` (chave de **sandbox**) |
| `ASAAS_ENV` | `sandbox` |
| `ASAAS_API_KEY` | chave do sandbox |
| `SUPABASE_SERVICE_ROLE_KEY` | chave de servidor do projeto Supabase **de teste** |
| `CRON_SECRET` | valor aleatório com 16+ caracteres |
| Banco | migrations aplicadas no projeto de teste e ao menos 1 plano ativo com preço maior que zero |
| Webhook | URL pública `https://<ambiente>/api/webhooks/asaas` (Preview ou túnel) |

Gere um token de webhook aleatório (32+ caracteres), cadastre-o em **/master/assinaturas** e cole o **mesmo valor** no Asaas
(Integrações → Webhooks → *Token de acesso*). Eventos a marcar: `PAYMENT_CREATED`, `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`,
`PAYMENT_OVERDUE`, `PAYMENT_REFUNDED`, `PAYMENT_DELETED`, `PAYMENT_RESTORED`, `PAYMENT_CHARGEBACK_REQUESTED`,
`SUBSCRIPTION_DELETED`, `SUBSCRIPTION_INACTIVATED`.

## 1. Conferir as suposições da API (script do repositório)

```bash
ASAAS_API_KEY=<chave-sandbox> node scripts/asaas-sandbox-check.mjs
ASAAS_API_KEY=<chave-sandbox> node scripts/asaas-sandbox-check.mjs --create
```

O primeiro só confirma a chave. O segundo cria e remove uma assinatura de R$ 5,00 e confere: leitura de volta (cliente, valor,
status e referência), busca por `externalReference` e leitura das cobranças. O script recusa chave de produção.

## 2. Roteiro do fluxo (marque o resultado esperado)

| # | Ação | Resultado esperado |
|---|---|---|
| 1 | Com uma loja de teste cujo teste gratuito já terminou, o OWNER abre **/painel/plano** e assina | Mensagem de sucesso; no Asaas aparece a assinatura com a referência do MenuNext; no banco a assinatura fica `pending`; o painel **continua bloqueado** |
| 2 | Clicar em assinar de novo | Não cria outra assinatura no Asaas (reencontra a da mesma tentativa) ou responde que já existe |
| 3 | No Asaas sandbox, confirmar o pagamento da primeira cobrança (botão de confirmar/receber pagamento do sandbox) | Webhook `PAYMENT_CONFIRMED`/`RECEIVED` chega; o painel e a loja pública são liberados; a assinatura vira `active` e o período vai até um mês após o vencimento |
| 4 | Reenviar o mesmo evento pelo painel do Asaas | Resposta `duplicate`, sem mudança |
| 5 | Forjar um evento: `curl` ao webhook com o token **certo** e o id de uma cobrança que ainda está pendente no Asaas | Resposta `unverified` (a API do Asaas não confirma); nada muda |
| 6 | `curl` ao webhook **sem** o token, ou com token errado | `401`; nenhum registro novo em `asaas_webhook_events` |
| 7 | Deixar a cobrança do mês seguinte vencer (ou usar a função de vencimento do sandbox, se existir) | `PAYMENT_OVERDUE`: assinatura `overdue`, painel e loja bloqueados |
| 8 | Pagar a cobrança vencida | Assinatura volta a `active`; acesso liberado |
| 9 | Cancelar a assinatura no Asaas | `SUBSCRIPTION_DELETED`: status `cancelled`, **acesso mantido até o fim do período pago**; depois bloqueia |
| 10 | Reabrir **/painel/plano** | Pode assinar de novo (nova assinatura) |
| 11 | **Webhook perdido:** pausar a fila de webhooks no Asaas (ou desligar a URL), pagar uma cobrança e então chamar a reconciliação (abaixo) | A cobrança é aplicada pela reconciliação e a loja é liberada |
| 12 | **Estorno:** estornar a cobrança paga no sandbox | `PAYMENT_REFUNDED`: o período correspondente deixa de contar e o acesso acaba |

### Chamar a reconciliação manualmente

```bash
curl -s -H "Authorization: Bearer <CRON_SECRET>" https://<ambiente>/api/cron/billing-reconcile
# esperado: {"ok":true,"checked":N,"applied":M,"unavailable":0,"notFound":0,"errors":0}
```

Sem o cabeçalho, ou com segredo errado, a resposta deve ser `401`; sem `CRON_SECRET` configurado, `503`.

## 3. Critérios de aprovação

- Nenhuma etapa libera acesso antes de pagamento confirmado **na API do Asaas**.
- Eventos repetidos, forjados ou fora de ordem não mudam o estado.
- Webhook perdido é recuperado pela reconciliação.
- Cancelar preserva o período pago; estorno e chargeback removem o período correspondente.
- O checkout dos clientes finais da loja continua funcionando durante todo o roteiro.
- Nenhum dado do Asaas de produção foi usado.

## 4. Depois do sandbox

Só então trocar para a chave de produção (`ASAAS_ENV=production`), cadastrar o token de webhook de produção e repetir os
passos 1 a 3 com um plano de valor baixo e uma conta real controlada por você.

# Mercado Pago — roteiro de validação no sandbox (antes de ativar cobrança)

O código do Mercado Pago foi escrito a partir da documentação oficial e testado
contra um simulador e contra o banco local. **Nenhum teste rodou contra o Mercado
Pago real.** Este roteiro valida o que só o ambiente deles confirma. Nada aqui usa
dinheiro real: use SEMPRE credenciais e usuários de teste.

## 1. Credenciais (nunca no repositório, nunca na tela do Master)

| Variável | De onde vem | Onde configurar |
|---|---|---|
| `MERCADOPAGO_ACCESS_TOKEN` | Suas integrações → seu app → Credenciais **de teste** | Vercel (Preview primeiro; Production só no go-live) |
| `MERCADOPAGO_WEBHOOK_SECRET` | Suas integrações → seu app → Webhooks → chave secreta | idem |
| `SUPABASE_SERVICE_ROLE_KEY` | já usada pela cobrança | idem |
| `CRON_SECRET` | já usado pela reconciliação | idem |

Sem as três primeiras o Mercado Pago aparece como "Credenciais pendentes" no Master
e **não é possível ativá-lo** (o servidor recusa).

## 2. Webhook

No painel do Mercado Pago, em Webhooks, use a URL mostrada no Master
(`https://<seu-domínio>/api/webhooks/mercadopago`) e ative os eventos
`subscription_preapproval` e `subscription_authorized_payment`.
A rota valida a assinatura (`x-signature`) com o segredo acima antes de qualquer
coisa; sem o segredo responde 503, com assinatura errada 401.

## 3. Roteiro (ambiente de Preview, banco de teste)

1. Master → Assinaturas: crie um plano de valor baixo (ex.: R$ 5,00).
2. Escolha **Mercado Pago** em "Provedor de cobrança".
3. Com um lojista de teste (OWNER, trial vencido ou não): Plano → **Assinar este plano**.
   Esperado: redireciona ao checkout do Mercado Pago; no banco a assinatura fica
   `pending` e **a loja não ganha acesso** por isso.
4. No checkout, pague com um **cartão de teste** do Mercado Pago, com o usuário
   comprador de teste (e-mail compatível com o do lojista).
5. Aguarde o webhook. Esperado: fatura `processed/approved` → assinatura `active`,
   período pago de 1 mês, loja liberada.
6. Feche o checkout antes de pagar numa segunda tentativa: o botão
   **Continuar pagamento no Mercado Pago** deve reabrir o link.
7. Rode a reconciliação (`GET /api/cron/billing-reconcile` com `Authorization: Bearer <CRON_SECRET>`)
   e confira que não muda nada de errado (`errors: 0`).
8. Cancele a assinatura no Mercado Pago e veja `cancelled` (período já pago preservado).
9. Recusa de cartão (cartão de teste que recusa): a fatura deve virar atraso e a loja
   bloquear no fim do período.

## 4. O que confirmar (hipóteses da documentação)

Se qualquer item abaixo for diferente, **pare e ajuste** antes de produção:

- `POST /preapproval` com `status: "pending"` devolve `init_point` (HTTPS de
  `mercadopago.com.br`/`.com`) e `id` alfanumérico de 10 a 64 caracteres.
- `GET /preapproval/{id}` devolve `status` (`pending` → `authorized`), `external_reference`
  igual ao id da assinatura do MenuNext e `auto_recurring.transaction_amount` numérico/string.
- `GET /preapproval/search?external_reference=` e
  `GET /authorized_payments/search?preapproval_id=` existem e paginam com `paging.total`.
- Fatura (`/authorized_payments/{id}`): `status` ∈ {`scheduled`, `processed`, `recycling`,
  `cancelled`}; `payment.status` (`approved`, `rejected`, `refunded`, `charged_back`...);
  `debit_date`, `transaction_amount`, `preapproval_id`.
- A notificação traz `data.id` na **query** (`?data.id=...&type=...`) e o cabeçalho
  `x-signature` no formato `ts=...,v1=...` com manifesto `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`.
- Cancelar (`PUT /preapproval/{id}` com `status: "cancelled"`) funciona também para assinatura `pending`.
- O pagador autorizando muda o `status` para `authorized` **sem** alterar `external_reference`.

## 5. Como reverter

- **Provedor:** Master → Assinaturas → volta para Asaas (só afeta NOVAS assinaturas).
- **Código:** promova na Vercel o deploy anterior.
- **Banco:** a migration `20261014000000_billing_mercadopago_provider` depende da P1-01 e só é
  aplicada com autorização, por `apply_migration` (nunca `db push`); o rollback é um script
  próprio que também remove a linha do registro de migrations (documentação privada do projeto).

## 6. Go-live (só depois de tudo acima passar)

1. Credenciais de **produção** do Mercado Pago na Vercel (Production).
2. Webhook de produção apontando para o domínio de produção, com a chave secreta de produção.
3. Uma assinatura real de valor mínimo, feita por você, conferida de ponta a ponta.
4. Só então Master → provedor **Mercado Pago**.

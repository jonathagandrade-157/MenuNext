# Pix com confirmação automática (v1)

**Estado:** implementado e **desligado**. Contém migration (`20261108010000_pix_automatico.sql`), que nunca
foi aplicada em produção. Testado em PostgreSQL sintético, com testes unitários e de ponta a ponta contra um
**simulador** do Mercado Pago. **Ainda não homologado com o Mercado Pago de verdade** (conta de teste): não
há credencial de teste nem projeto Supabase de homologação no ambiente.

## Como funciona

1. O lojista (OWNER) abre **Painel → Pagamentos → Pix automático** e cola o *Access Token* da conta Mercado Pago
   **dele**. O dinheiro cai direto nessa conta; o MenuNext nunca recebe nem repassa valores.
2. O servidor confere o token na API (`GET /users/me`), descobre o **id da conta recebedora** e cifra o token
   (AES-256-GCM, chave `PAYMENTS_ENCRYPTION_KEY`, amarrada ao id da loja). No banco ficam só o texto cifrado, os 4
   últimos caracteres e o id da conta. Ninguém lê o token pela API do banco, nem o próprio OWNER. Token novo
   nasce desligado.
3. Opcional, mas recomendado: a **assinatura secreta de webhooks** da aplicação da loja, também cifrada.
4. Pedido com Pix numa loja ligada, em três passos:
   1. o banco **reserva** a cobrança (`creating`) com o **total do pedido**, uma tentativa por vez;
   2. o servidor cria o Pix no Mercado Pago com **idempotência pelo pedido** (`X-Idempotency-Key`): repetir
      devolve o mesmo pagamento;
   3. a resposta é conferida (valor, referência, moeda BRL, conta recebedora) e registrada (`pending`). Só então
      o cliente vê o QR, válido por 30 minutos.
5. **Confirmação:** a página do pedido pergunta a cada 5 s, e o webhook (se configurado) avisa. Nos dois casos o
   servidor **consulta o pagamento na API do Mercado Pago** com o token da loja. O banco só marca pago com
   **valor, moeda BRL, conta recebedora e referência do pedido** iguais. O pedido ganha `paid_at`.

## Regras contra cobrança duplicada e pagamento perdido

| Situação | O que o cliente vê | O que a loja vê no painel |
| --- | --- | --- |
| Criando (`creating`), inclusive com resposta indefinida (rede, 5xx, 429) | "Gerando o QR Code… aguarde antes de pagar". **Não** mostra a chave Pix comum | "gerando a cobrança" |
| Pendente (`pending`) | só o QR dinâmico e o copia e cola | "aguardando o cliente pagar" |
| Pago (`approved`) | confirmação | "confirmado pelo Mercado Pago" + **Pago** |
| Recusa definitiva do provedor (4xx), conta/valor divergente, 6 tentativas indefinidas | chave Pix comum + "a loja confere esse pagamento manualmente" | "não concluído — confira no extrato" |
| Expirado/cancelado | chave Pix comum + conferência manual | "não concluído — confira no extrato" |
| Pix sem cobrança automática (recurso desligado) | chave Pix comum, como hoje | "Pix pela chave da loja — confira no extrato" |

- A chave Pix comum só aparece quando **nenhum QR automático válido foi mostrado** ao cliente. Assim não
  existem duas formas de pagar o mesmo pedido ao mesmo tempo.
- Uma resposta indefinida é tentada de novo com a **mesma** chave de idempotência. Se o Mercado Pago criou a
  cobrança e a resposta se perdeu, a nova tentativa recebe a mesma cobrança, não uma segunda.
- **Pago é final.** Eventos duplicados, atrasados ou fora de ordem (pendente/cancelado depois de pago) não mudam
  nada. Uma aprovação que chega depois de "expirado/cancelado" do nosso lado ainda vale: o dinheiro entrou.
- **Pagamento pela chave Pix comum nunca é confirmado automaticamente.** A loja confere no extrato.

## Webhook (documentação vigente do Mercado Pago)

- URL: `https://<domínio>/api/webhooks/pix-mercadopago`, evento **Pagamentos**. Enviada em cada cobrança
  (`notification_url`) quando `PIX_WEBHOOK_URL` está configurada. Sem ela, a confirmação vem da página do pedido
  aberta.
- Validação: `x-signature` (`ts=…,v1=…`) = HMAC-SHA256 da assinatura secreta sobre
  `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, comparado em tempo constante. Loja com assinatura cadastrada:
  aviso sem assinatura válida recebe **401** e nada é consultado.
- Mesmo com assinatura válida, o corpo nunca é prova: o aviso só dispara a consulta ao provedor. Falha transitória
  responde 500 (o Mercado Pago reenvia); recurso desligado responde 404. Há limite por IP.

## Variáveis (servidor; NUNCA com prefixo `NEXT_PUBLIC_`)

Cadastrar em **Vercel → projeto menunext → Settings → Environment Variables**: primeiro no ambiente **Preview**
ligado à homologação, nunca em Production nesta fase. Não colar valores em chat, issues ou commits.

| Variável | Conteúdo |
| --- | --- |
| `PIX_AUTO_ENABLED` | `true` para ligar; qualquer outro valor desliga (webhook 404, nenhuma cobrança nova) |
| `PAYMENTS_ENCRYPTION_KEY` | 32 bytes aleatórios em base64 (`openssl rand -base64 32`). Se mudar, os tokens gravados deixam de abrir e cada loja cola de novo |
| `PIX_PAYER_EMAIL` | e-mail da plataforma usado como pagador (o Mercado Pago exige um; o checkout não pede e-mail). Não pode ser o e-mail de nenhuma loja |
| `PIX_WEBHOOK_URL` | opcional: `https://<domínio do preview>/api/webhooks/pix-mercadopago` |
| `SUPABASE_SERVICE_ROLE_KEY` | já usada pela cobrança da assinatura; necessária aqui também |

O **Access Token de teste** (`TEST-…`) e a **assinatura secreta** da conta de teste do Mercado Pago **não** são
variáveis: são colados pelo OWNER na tela de Pagamentos do ambiente de homologação, que os cifra.

## Homologação com o provedor (pendente — roteiro)

1. Criar o projeto Supabase de homologação do MenuNext (dados sintéticos) e aplicar a migration. Rodar
   `supabase/tests/pix_automatico.sql`: tem de terminar com `RESULTADO: OK`.
2. Preview da Vercel apontando para esse projeto, com as variáveis acima.
3. No Mercado Pago (Suas integrações), criar uma aplicação e **contas de teste** (vendedor e comprador). Colar o
   token `TEST-…` do vendedor no painel e cadastrar o webhook com a assinatura secreta.
4. Roteiro: pedido Pix → QR → pagar com o comprador de teste → confirmação automática; webhook adulterado → 401;
   deixar expirar → chave comum com aviso; conferir no painel do Mercado Pago que existe **uma** cobrança por pedido.
5. Registrar as evidências sem expor token, assinatura ou dados de cartão/conta.

Desligar: `PIX_AUTO_ENABLED` diferente de `true`. Rollback do banco:
`supabase/rollback/20261108010000_pix_automatico.down.sql`. Apaga cobranças e tokens; os pagamentos continuam na
conta Mercado Pago das lojas.

## Fora desta versão

- Estorno e cancelamento automáticos (cancelar um pedido pago exige devolver o Pix pelo app do Mercado Pago).
- Reconciliação agendada (cron) de cobranças pendentes com a página fechada e sem webhook.
- Confirmar o pedido sozinho quando o pagamento entra (hoje só marca **Pago**).

## Evidências desta versão (sem provedor real)

- `supabase/tests/pix_automatico.sql`: 63 verificações (PostgreSQL 16 sintético e CI com 17). Mutação: sem a
  checagem de moeda e conta recebedora, 3 falhas.
- `src/lib/pixAuto.test.ts`: 36 testes, incluindo a assinatura do webhook calculada exatamente como na
  documentação, resposta indefinida x definitiva e conta/moeda divergentes.
- `scripts/stack-lab/e2e-pix.cjs`: **19/19**. Navegador → build de produção → PostgREST → PostgreSQL, com o
  **simulador** `fake-mercadopago.mjs` no lugar do Mercado Pago (redirecionado só no processo de teste por
  `mp-redirect.cjs`). Cobre configuração no painel, token recusado, QR dinâmico, webhook sem assinatura,
  adulterado, pendente e aprovado, aviso duplicado, confirmação na página e no painel, resposta indefinida com
  "gerando" e uma única cobrança, recusa definitiva com chave comum, e cobrança em outra conta descartada.
  **Não substitui a homologação com o provedor.**
- Bugs encontrados por esses testes e corrigidos: ambiguidade de `attempts` na reserva (quebraria a primeira
  nova tentativa); throttle que descartava o aviso de aprovação com 200; assinatura conferida só depois da
  consulta (aviso já pago ou descartado respondia 200 mesmo com assinatura falsa).

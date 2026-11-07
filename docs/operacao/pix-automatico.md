# Pix com confirmação automática (v1)

**Estado:** implementado e **desligado**. Contém migration (`20261108010000_pix_automatico.sql`), que nunca
foi aplicada em produção. Testado em PostgreSQL sintético e com um Mercado Pago simulado nos testes. **Ainda
não testado com uma conta Mercado Pago real** (sandbox).

## Como funciona

1. O lojista (OWNER) abre **Painel → Pagamentos → Pix automático**, cola o *Access Token* da conta Mercado Pago
   **dele** e liga o recurso. O dinheiro cai direto nessa conta; o MenuNext nunca recebe nem repassa valores.
2. O servidor cifra o token (AES-256-GCM) com `PAYMENTS_ENCRYPTION_KEY` **antes** de gravar. No banco ficam só o
   texto cifrado e os 4 últimos caracteres. Ninguém lê o token pela API do banco, nem o próprio OWNER.
3. Pedido com Pix numa loja com o recurso ligado: o servidor cria **uma** cobrança Pix com o **total lido do
   banco**, válida por 30 minutos, e a página do pedido mostra o QR Code e o copia e cola.
4. A confirmação nunca vem do navegador nem do corpo do webhook. A página do pedido pergunta a cada 5 s (e o
   webhook, se configurado, avisa); o servidor **consulta o pagamento na API do Mercado Pago** com o token da loja,
   e o banco só marca pago se valor e referência (id público do pedido) baterem. Pago é final. O pedido ganha
   `paid_at` e aparece como **Pago** no painel.
5. Se qualquer passo falhar (Mercado Pago fora do ar, token inválido), o pedido continua valendo e a página mostra
   a chave Pix estática da loja, como hoje.

## Para ligar (nesta ordem; nada disso foi feito)

1. Homologação: aplicar a migration, rodar `supabase/tests/pix_automatico.sql`.
2. Variáveis no servidor (Vercel, **sem** `NEXT_PUBLIC_`):
   - `PAYMENTS_ENCRYPTION_KEY`: 32 bytes aleatórios em base64 (`openssl rand -base64 32`). Guardar com cuidado:
     se ela mudar, os tokens gravados deixam de abrir e cada loja precisa colar o token de novo.
   - `PIX_PAYER_EMAIL`: e-mail da plataforma usado como "pagador" (o Mercado Pago exige um; o checkout não
     pede e-mail ao cliente). Não pode ser o e-mail da conta de nenhuma loja.
   - `PIX_WEBHOOK_URL` (opcional): `https://<domínio>/api/webhooks/pix-mercadopago`. Sem ele, a confirmação
     vem só da página do pedido aberta.
   - `PIX_AUTO_ENABLED=true` por último.
3. Ensaio com **credenciais de teste** (`TEST-...`) de uma conta de teste do Mercado Pago: pedido → QR →
   pagamento de teste → confirmação. Conferir os campos reais da resposta (`point_of_interaction`,
   `date_of_expiration`, status de expiração).
4. Só então uma loja piloto com o token de produção.

Para desligar: `PIX_AUTO_ENABLED` diferente de `true` (o webhook volta a responder 404 e nenhuma cobrança nova é
criada; as já criadas continuam visíveis). Rollback do banco: `supabase/rollback/20261108010000_pix_automatico.down.sql`
(apaga cobranças e tokens; os pagamentos continuam na conta Mercado Pago das lojas).

## Fora desta versão

- Estorno e cancelamento automáticos (cancelar um pedido pago exige devolver o Pix pelo app do Mercado Pago).
- Reconciliação agendada (cron) de cobranças pendentes com a página fechada e sem webhook.
- Outros provedores (Asaas, Efí, banco direto).
- Confirmar o pedido sozinho quando o pagamento entra (hoje só marca **Pago**; o fluxo de status segue manual).

## Segurança

- O token só existe em claro na memória do servidor, durante a chamada ao Mercado Pago. Nunca vai para log, para
  o navegador nem para o Sentry.
- O texto cifrado está amarrado ao id da loja: copiar o de uma loja para outra não funciona.
- As funções que criam e aprovam cobranças só executam com `service_role`. As do painel exigem OWNER (a equipe
  só vê se está ligado), e a do cliente só devolve a cobrança do próprio pedido (pelo id público, como a página
  do pedido).
- A página do pedido e o webhook têm limite por IP, e a consulta ao Mercado Pago tem intervalo mínimo por cobrança.

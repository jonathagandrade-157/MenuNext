# Teste ponta a ponta da cobrança (Asaas simulado e Asaas Sandbox)

Valida a cobrança de assinaturas **sem pagamentos reais e sem tocar na produção**: banco PostgreSQL isolado, o backend
Next.js real e, no lugar do Asaas, primeiro um servidor simulado e depois o **Sandbox** do Asaas.

## 1. Peças

| Peça | Onde | Função |
|---|---|---|
| Banco isolado | PostgreSQL 17 + PostgREST locais, com todas as migrations (a nova inclusive) | Nunca é o Supabase real |
| Backend | `next start` do projeto, apontado para o banco isolado | Webhook, reconciliação e Server Action de verdade |
| Asaas simulado | `src/integration/fakeAsaas.ts` | Mesmos endpoints e formatos de payload; permite forjar divergências |
| Ensaio completo | `src/integration/billing.e2e.test.ts` (17 cenários) | Roda contra o Asaas simulado |
| Roteiro do Sandbox | `src/integration/billing.sandbox.test.ts` (9 passos) | Age pela API do Asaas e espera o efeito no banco; alvo `fake` ou `real` |
| Porteiro do webhook | `scripts/webhook-gate.mjs` | Única porta exposta à internet: só `POST /api/webhooks/asaas` |
| Conferência da API | `scripts/asaas-sandbox-check.mjs` | Confere as suposições da API do Sandbox (recusa chave de produção) |

Os testes de integração **só rodam com variáveis de ambiente** (`BILLING_E2E=1` ou `SANDBOX_E2E=1`) e ficam "ignorados" na
suíte normal e na CI.

## 2. O que o ensaio completo cobre (Asaas simulado)

Assinatura legítima; ids inventados e vínculo com dados de outra conta; leitura de volta divergente (valor, cliente,
referência, status); cobrança pendente; confirmação forjada; pagamento de valor incorreto; confirmação, duplicidade e
`RECEIVED` da mesma cobrança; evento fora de ordem; renovação com atraso; estorno; webhook perdido (pagamento, estorno e
cancelamento) recuperado pela reconciliação; cancelamento com período pago; Asaas fora do ar (503).

## 3. Como rodar no Sandbox real

### 3.1 Pré-requisitos (você)

1. Conta no `https://sandbox.asaas.com` e uma **chave de API do Sandbox** (Integrações → Chave de API).
2. Guarde a chave **apenas** em um arquivo fora do repositório (uma pasta sua, fora da pasta do projeto), com uma linha
   `ASAAS_API_KEY=<chave>`. Não cole a chave em conversas, issues ou commits. Carregue o arquivo no ambiente só ao rodar; o
   roteiro lê a variável `ASAAS_API_KEY` e nunca a imprime.
3. Um endereço público HTTPS temporário que aponte para o **porteiro** (item 3.2).

### 3.2 Endereço público temporário

O Asaas só entrega webhooks em um endereço público. Aponte o túnel para o porteiro (porta 3100), **nunca** para o Next
diretamente:

```bash
node scripts/webhook-gate.mjs
```

Opções de túnel (escolher uma; ambas gratuitas e sem conta):

- `cloudflared tunnel --url http://127.0.0.1:3100` (baixar o executável do repositório oficial da Cloudflare e conferir o
  SHA-256 publicado na página da versão).
- `ssh -R 80:127.0.0.1:3100 nokey@localhost.run` (não instala nada; usa o OpenSSH do Windows).

Riscos e mitigações:

- O provedor do túnel enxerga o tráfego, **inclusive o token do webhook**: use um token de teste exclusivo, gerado só para isso,
  e descarte-o depois.
- O porteiro expõe uma única rota, corpo de até 64 KB e 60 requisições por minuto; todo o resto (painel, login, reconciliação,
  arquivos) responde 404. Sem o token certo, o backend responde 401.
- O endereço é aleatório e existe só enquanto o túnel estiver aberto. Feche o túnel ao terminar e apague o webhook no painel
  do Sandbox.
- Nenhuma credencial de produção (Supabase ou Asaas) existe no ambiente.

### 3.3 Configurar o webhook no Sandbox

No painel do Sandbox: URL `https://<endereço do túnel>/api/webhooks/asaas`, **Token de acesso** igual ao token do laboratório e
os eventos `PAYMENT_CREATED`, `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, `PAYMENT_REFUNDED`,
`PAYMENT_DELETED`, `PAYMENT_RESTORED`, `PAYMENT_CHARGEBACK_REQUESTED`, `SUBSCRIPTION_DELETED`, `SUBSCRIPTION_INACTIVATED`.

### 3.4 Executar

Com o banco isolado e o `next start` rodando (mesma `ASAAS_API_KEY` do Sandbox e `ASAAS_ENV=sandbox`, **sem**
`ASAAS_BASE_URL`):

```bash
SANDBOX_E2E=1 SANDBOX_TARGET=real BILLING_LAB_STATE=<estado-do-laboratório> npx vitest run src/integration/billing.sandbox.test.ts
```

O roteiro recusa `ASAAS_ENV=production` e chave de produção, cria assinaturas de R$ 5,00 com dados fictícios, remove tudo
no Sandbox ao final e imprime, para cada efeito, se chegou por **webhook** ou só pela **reconciliação**. `SANDBOX_WEBHOOKS=0`
pula a espera por webhooks (só reconciliação).

## 4. O que o Sandbox pode não permitir

A documentação do Asaas não detalha tudo o que o Sandbox simula. O roteiro usa `receiveInCash` (gera `PAYMENT_RECEIVED`),
estorno e remoção de assinatura pela API. **Atraso (`PAYMENT_OVERDUE`) e chargeback** dependem de recursos do painel do Sandbox
que podem não existir; nesse caso ficam cobertos pelos testes do banco e pelo ensaio com o Asaas simulado, e o resultado
registra a limitação.

## 5. Critérios de aprovação

- Nenhuma etapa libera acesso antes de pagamento confirmado **na API do Asaas**.
- Eventos repetidos, forjados ou fora de ordem não mudam o estado.
- Webhook perdido é recuperado pela reconciliação.
- Cancelar preserva o período pago; estorno remove o período correspondente.
- O checkout dos clientes finais continua funcionando durante todo o roteiro.
- Nenhum dado de produção foi usado.

## 6. Depois do Sandbox

Só então trocar para a chave de produção (`ASAAS_ENV=production`), cadastrar o token de webhook de produção e repetir os
passos com um plano de valor baixo e uma conta real controlada por você.

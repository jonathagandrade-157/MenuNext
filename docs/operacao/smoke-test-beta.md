# Roteiro de smoke test — fluxo completo (beta)

Objetivo: provar, **uma vez por versão**, que um restaurante consegue sair do cadastro até operar pedidos, e que o STAFF
só faz o que pode. **Não foi executado** (não existe validação real deste fluxo ainda). Rode em ambiente de **teste**
(banco/projeto descartável ou conta de teste isolada), nunca com dados de clientes reais.

> Regras: use apenas os dados sintéticos abaixo; não digite senha, CPF/CNPJ ou cartão reais; não use pagamento real.
> Faça um registro (data, versão/commit, quem executou, resultado de cada passo e evidência).

## Pré-requisitos

- Ambiente com a versão a testar (`git rev-parse HEAD` anotado) e as migrations aplicadas **nesse ambiente**.
- `SUPABASE_SERVICE_ROLE_KEY` configurada no servidor (sem ela o checkout público falha fechado de propósito).
- Envio de e-mail do ambiente funcionando **ou** confirmação de e-mail desativada no projeto de teste (anote qual).
- Navegador com janela anônima + um segundo dispositivo/janela para o STAFF e outro para o cliente.
- Dados sintéticos (gere CPF/CNPJ de teste válidos pelo dígito verificador; e-mails no domínio de teste):

| Papel | E-mail | Observação |
|---|---|---|
| OWNER | `dono+smoke1@exemplo.invalid` | senha forte gerada para o teste |
| STAFF | `equipe+smoke1@exemplo.invalid` | convidado pelo OWNER |
| Cliente | nome "Cliente Teste", telefone `11 90000-0001` | sem conta |

Loja: "Loja Smoke 1", slug `loja-smoke-1`, produto "X-Teste" R$ 30,00, categoria "Lanches", cupom `SMOKE5` (R$ 5, 1 uso).

## Passos, resultado esperado e evidência

| # | Passo | Resultado esperado | Evidência |
|---|---|---|---|
| 1 | **Cadastro** em `/cadastro` com os dados do OWNER, aceitando os termos | conta criada; vai ao onboarding (ou pede confirmação de e-mail) | captura da tela |
| 2 | **Confirmação de e-mail** (se ativa): abrir o link recebido no mesmo navegador | sessão ativa; sem erro de redirecionamento | captura + cabeçalho do e-mail |
| 3 | **Recuperar senha**: sair, "Esqueci minha senha", usar o link e definir nova senha | e-mail chega; nova senha funciona; outras sessões saem | captura |
| 4 | **Onboarding** (7 passos): nome, endereço, entrega/retirada, horários (aberto 24 h no teste), pagamentos (Pix com chave de teste) | `/onboarding/loja-pronta` mostra o link real `/loja/loja-smoke-1` | captura |
| 5 | **Produto**: criar categoria "Lanches" e produto "X-Teste" (R$ 30) com 1 foto JPG pequena | produto na lista; foto aparece (quadrada, WebP) | captura |
| 6 | **Cupom**: criar `SMOKE5` (fixo R$ 5, 1 uso) | cupom ativo | captura |
| 7 | **Loja pública**: abrir `/loja/loja-smoke-1` em janela anônima, celular 375 px | título da aba com o nome da loja; produto visível; sem rolagem lateral | captura |
| 8 | **Sacola → checkout**: adicionar 1 item, aplicar `SMOKE5`, escolher retirada + Pix | total R$ 25,00; mensagem de cupom aplicado | captura |
| 9 | **Pedido**: confirmar | página do pedido com número; tela mostra a chave Pix/“Copia e Cola”; **não** diz que o pagamento foi confirmado | captura |
| 10 | **Idempotência**: repetir o envio (duplo clique / atualizar) | continua 1 só pedido | contagem no painel |
| 11 | **Cupom de 1 uso**: tentar novo pedido com `SMOKE5` (outro telefone) | recusado: limite de usos | captura |
| 12 | **Kanban** (`/painel/pedidos`): pedido chega **sem recarregar**, com alerta sonoro | card em "Recebido" | captura |
| 13 | **Avançar** o pedido: Recebido → Preparando → Pronto → … | cada passo reflete no rastreamento do cliente | capturas |
| 14 | **KDS** (`/painel/kds`): o pedido aparece e avança | consistente com o Kanban | captura |
| 15 | **Cancelamento**: criar novo pedido e cancelar com motivo | status Cancelado; cliente vê cancelado; cupom/valores coerentes | captura |
| 16 | **Equipe**: OWNER convida `equipe+smoke1@…`; STAFF aceita o convite (link) | STAFF entra | captura |
| 17 | **STAFF pode**: ver/avançar/cancelar pedidos, ligar/desligar disponibilidade de produto, vender no balcão (caixa aberto) | funciona | capturas |
| 18 | **STAFF não pode**: editar produto/preço, cupons, equipe, pagamentos/Pix, plano, pausar a loja; abrir `/painel/produtos` etc. | redirecionado/negado, sem erro 500 | capturas |
| 19 | **Isolamento**: com a conta de OWNER de **outra** loja de teste, tentar abrir pedido/produto da Loja Smoke 1 por URL | negado/404 | captura |
| 20 | **Chamada direta à API** (só em ambiente de teste, com a chave pública): `POST /rest/v1/rpc/create_order` | `permission denied` (HTTP 401/403) e nenhum pedido criado | resposta |
| 21 | **Limites**: enviar 9 pedidos seguidos do mesmo IP/loja em < 10 min | a partir do limite, mensagem "Muitas tentativas… aguarde N minutos" (não erro técnico) | capturas |
| 22 | **Loja fechada/pausada**: pausar a loja (OWNER) e tentar pedir | cliente vê indisponível; STAFF não consegue pausar | captura |

## Limpeza

1. Apagar os dados de teste do **ambiente de teste** (restaurante, usuários `*+smoke1@exemplo.invalid`, arquivos do bucket
   da loja de teste). Em banco descartável, descartar o banco inteiro.
2. Revogar qualquer chave/convite criado; remover usuários de teste do provedor de e-mail.
3. Guardar o registro e as evidências **fora do Git** (podem conter e-mails e capturas de telas internas).
4. Se algum passo falhar: anotar passo, versão, mensagem exibida e hora; **não** "consertar em produção".

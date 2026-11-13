# Anti-robô (Cloudflare Turnstile)

Cobre **cadastro, login e recuperação de senha**. O pedido do checkout entra depois da PR #6 (mesmo arquivo).

## Ativação (desligada por padrão)
Defina **as duas** (uma só não liga e gera aviso no log, para não trancar ninguém): `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (pública, embutida no build — exige novo build) e
`TURNSTILE_SECRET_KEY` (servidor). Opcional: `TURNSTILE_ALLOWED_HOSTNAMES` (vírgula) se um proxy reescrever o `Host`. Desligar: apague as variáveis e reimplante.

## O que o servidor confere (falha fechado)
Token presente (≤ 2048), aceito pela API `siteverify`, **`hostname` igual ao do pedido** e **`action` igual à do formulário** (`login`, `cadastro`, `recuperar`): token de outro site ou de outro formulário não vale.
`timeout-or-duplicate` → "expirou ou já foi usado". Cloudflare fora do ar, resposta inválida ou **nossa chave secreta recusada** (`invalid-input-secret`, com aviso ao operador, sem expor a chave) → negado. Roda depois do limite por IP.
Com os segredos de TESTE oficiais a conferência de `hostname`/`action` é pulada (a resposta deles traz `example.com` e nenhuma `action`); isso nunca ocorre com chave real.

## Matriz de evidências — não confunda os níveis
| Nível | O que foi feito | Resultado |
|---|---|---|
| **Simulado** (testes de unidade, `fetch` falso) | ausente, gigante, inválido, expirado/duplicado, hostname/action trocados, Cloudflare fora, resposta não-JSON, chave secreta recusada, uma só chave, CSP | 31 testes passam |
| **Provedor real** (API `siteverify` com segredos de teste oficiais) | aprova, reprova, `timeout-or-duplicate`, chave secreta desconhecida, rede fora | 6/6 (`src/integration/turnstile.provider.test.ts`, `TURNSTILE_PROVIDER_TEST=1`) |
| **Navegador real** (Chromium, app compilado, widget e API reais, chaves de teste) | widget renderiza; token entra no formulário; login/cadastro/recuperação passam com token válido; servidor nega com segredo que reprova e com "expirado"; widget reinicia após cada resposta; chave 3x: **iframe** do desafio carrega sob a CSP e envio sem resolver é negado; chave 2x: sem token, negado; **zero violações de CSP** e zero erros de JavaScript | todos passam (`scripts/turnstile-browser/`) |
| **Produção / chaves reais** | **NÃO validado** | Pendente |

## Limites que o teste não alcança
Token realmente vencido ou reutilizado só existe com chaves reais (o segredo `3x…` reproduz a mesma resposta). A chave de teste "sempre aprova" é invisível e devolve sempre o mesmo token literal, então "token novo" não é observável — comprova-se o **reinício** (campo esvaziado e preenchido de novo). Desafios reais (Managed/Interactive) com pessoas, acessibilidade, bloqueadores de anúncio/rastreamento e navegadores móveis precisam de teste manual. Se a Cloudflare cair com a verificação ligada, ninguém consegue entrar/cadastrar (escolha consciente).

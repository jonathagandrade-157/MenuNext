# Isolamento do painel Master

O Master enxerga e altera **todas as lojas**. Por isso ganhou três camadas extras, todas **desligadas por padrão** (nada muda até você
configurar) e todas **só podem negar** acesso: quem passa ainda precisa ser administrador da plataforma (`is_platform_admin`, no banco).

| Variável (servidor) | Efeito |
|---|---|
| `MASTER_HOST` | `/master` só responde neste domínio (ex.: `master.seudominio.com.br`). Em qualquer outro (loja pública, `*.vercel.app`) responde **404**. |
| `MASTER_ALLOWED_IPS` | Lista separada por vírgula de IPs ou faixas CIDR, **IPv4 e IPv6** (`203.0.113.7,198.51.100.0/24,2001:db8::/32`). Fora da lista: **404**. IPv4 mapeado em IPv6 (`::ffff:a.b.c.d`) vale como IPv4; grafias diferentes do mesmo IPv6 são equivalentes. |
| `MASTER_PROXY_HOPS` | Quantos proxies/CDNs ficam à frente do app (padrão `1` = só a Vercel). Some 1 para cada CDN extra. |
| `MASTER_REQUIRE_MFA=true` | Exige segundo fator TOTP (AAL2 do Supabase) em toda página e ação do Master; sem ele, redireciona para `/master-mfa`. |

Além disso, as respostas do Master saem com `Cache-Control: private, no-store` e `X-Robots-Tag: noindex, nofollow, noarchive`.

## De onde vêm host e IP (revisão de segurança)
- **Host:** somente o cabeçalho `Host`. `X-Forwarded-Host` é **ignorado**: o cliente consegue escrevê-lo. (A primeira versão o aceitava e isso permitia contornar `MASTER_HOST`; foi corrigido e há teste de regressão.)
- **IP:** a entrada do `X-Forwarded-For` contada **da direita** (a que o proxy de borda acrescentou), nunca a primeira (o cliente escreve nela). Sem `X-Forwarded-For`, o IP é desconhecido e **é negado** quando há lista; `X-Real-IP` não é usado.
- **Suposição que o código não consegue provar:** que o proxy de borda realmente acrescenta/reescreve o `X-Forwarded-For` com o IP de quem conectou (é o comportamento documentado da Vercel). **Confirme na homologação** enviando `X-Forwarded-For`/`X-Forwarded-Host` falsos ao domínio do Master e verificando 404. Com outro CDN na frente, ajuste `MASTER_PROXY_HOPS`.
- Listas de IP com entradas inválidas descartam as inválidas; se sobrar nenhuma válida, **nega tudo**.

## Como a decisão é tomada
1. **Proxy** (`src/proxy.ts`): rotas `/master`, `/master/*` e `/master-mfa` passam pela política *antes* de qualquer sessão ou banco.
2. **Defesa em profundidade:** o layout do Master e `requireMasterPage` (usado por páginas e Server Actions) repetem a checagem, porque Server Actions são endpoints próprios.
3. **Falha fechado:** variável definida porém inválida (lista só com lixo) nega tudo; IP desconhecido nunca passa quando há lista.
4. Teste estático: ninguém pode chamar `is_platform_admin` fora do guarda central, e o layout/`requireMasterPage` precisam chamar as duas verificações.

## Como ligar (nesta ordem, para não se trancar do lado de fora)
1. **Segundo fator primeiro.** No Supabase (Auth → MFA) confirme que TOTP está habilitado. Entre como administrador e acesse `/master-mfa` (disponível mesmo com `MASTER_REQUIRE_MFA` desligado): cadastre o aplicativo autenticador **antes** de ligar a exigência. Guarde as cópias de segurança do seu aplicativo autenticador; **o app não guarda segredo nenhum**.
2. **Domínio separado (recomendado).** Na Vercel, adicione `master.seudominio.com.br` ao mesmo projeto, defina `MASTER_HOST` com esse nome e use só ele para o Master. Dica: proteja também esse domínio com a Vercel Authentication / regras do Firewall.
3. **Lista de IPs (opcional).** Só se você tem IP fixo (escritório/VPN). Com IP residencial dinâmico você se tranca para fora; mantenha um segundo IP/VPN ou prefira o MFA.
4. Defina as variáveis no ambiente (Production) e faça um novo deploy.

**Rollback de emergência:** apague a variável na Vercel e reimplante; o comportamento volta ao anterior.

## Risco residual do primeiro cadastro de fator
Quem tem só a **senha** do administrador e chega a `/master-mfa` *antes* de o administrador cadastrar o autenticador consegue cadastrar o PRÓPRIO autenticador e passar a ser AAL2. A tela só oferece cadastro quando não há fator verificado, mas isso não impede chamadas diretas à API do Supabase Auth. Mitigações: cadastre o seu autenticador **antes** de qualquer outra coisa, use `MASTER_ALLOWED_IPS`/`MASTER_HOST` durante o cadastro e rotacione a senha do administrador se houver suspeita.

## O que isto NÃO faz
- Não substitui 2FA nas contas **GitHub, Vercel e Supabase**, que também dão acesso ao Master por outros caminhos.
- Não impede que um administrador com sessão roubada *dentro* da rede permitida e já em AAL2 aja — por isso o histórico de auditoria existe.
- O banco ainda **não exige AAL2**: quem tiver o JWT de um admin em AAL1 poderia chamar as RPCs `master_*` direto pela API do Supabase. Fechar isso exige uma migration (`auth.jwt()->>'aal' = 'aal2'` em `is_platform_admin`), que não foi aplicada nem escrita aqui — deve ser feita junto da homologação.
- Não foi testado contra o Supabase Auth real (pausado): o fluxo de cadastro/verificação do TOTP precisa de teste manual em homologação. A política de rede foi testada em execução real do app compilado.

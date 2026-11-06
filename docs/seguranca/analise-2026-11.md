# Análise de segurança — novembro/2026

**Escopo:** código do repositório na main (`bb48b70`) e as PRs pendentes, migrations e suítes SQL. **Método:** leitura do código, buscas
automatizadas (segredos, `innerHTML`/`eval`, rotas públicas), `npm audit`, e as suítes SQL no PostgreSQL sintético do CI.
**Limite:** não tive acesso ao Supabase hospedado (pausado), ao painel da Vercel nem a testes de invasão ao vivo. Nada abaixo foi
testado contra produção. "Seguro contra hackers e robôs" não é um estado que se prove: este documento lista o que está protegido,
o que não está e o que **não pude verificar**.

## O que já está bem (com evidência)
- **Isolamento entre lojas e papéis OWNER/STAFF:** RLS e funções `SECURITY DEFINER` com 1.500+ verificações SQL no CI, incluindo `tenant_isolation` e escrita direta negada nas tabelas novas.
- **Chave `service_role` só no servidor:** teste estático falha se ela (ou as chaves do Asaas, Mercado Pago, Resend) for lida fora do módulo previsto, importada por componente de cliente ou ganhar prefixo `NEXT_PUBLIC_`.
- **Cabeçalhos e CSP:** CSP com nonce por requisição e `strict-dynamic` em produção, `frame-ancestors 'none'`, `base-uri 'self'`, `object-src 'none'`; `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`; `X-Powered-By` desligado.
- **XSS:** nenhuma ocorrência de `dangerouslySetInnerHTML`, `innerHTML`, `eval` ou `new Function` em `src`. HTML de e-mail escapa entradas.
- **Upload de imagens:** limite de 5 MB, tipos permitidos (JPEG/PNG/WebP, sem SVG), verificação de bytes reais (magic bytes) e reencode.
- **Open redirect:** `safeNextPath` só aceita caminho interno conhecido.
- **Segredos comparados em tempo constante** (`safeEqual`); cron exige `CRON_SECRET` de 16+ caracteres e falha fechado; webhooks conferem o pagamento na API do provedor; nenhum segredo no repositório (varredura sem achados; só `.env.example` versionado).
- **CSV:** sem dados pessoais de clientes e com neutralização de fórmulas.

## Achados

### Alta
**A1. Robôs podem chamar `create_order`, `validate_coupon`, `preview_promotion` e `is_document_eligible` direto pela API pública do Supabase, contornando todos os limites do aplicativo.**
O laboratório confirma que, no estado atual das migrations, `anon` e `authenticated` executam essas funções. Consequências: criação de pedidos falsos em massa (sem a guarda de rajada), adivinhação de cupons e **consulta de existência de CPF/CNPJ** (vazamento de privacidade).
*Correção pronta e testada só em sintético:* #6 (aplicativo) → migration 1 (guarda de rajada) → migration 2 (revoga o acesso público). **Bloqueada por homologação.** Enquanto isso, o único freio é a validação interna das próprias funções e a idempotência.

**A2. Os limites de tentativas dependem de `SUPABASE_SERVICE_ROLE_KEY` e falham aberto.**
Sem a variável (ou com o contador fora do ar) login, cadastro, recuperação de senha, cupom e frete ficam **sem limite**, em silêncio (só um `console.error`). *Ação:* confirmar a variável na Vercel; avaliar falhar fechado para login/cadastro/recuperação (hoje a escolha foi priorizar disponibilidade da loja).

### Média
**M1. Sem verificação anti-robô (CAPTCHA/desafio) em cadastro, login, recuperação de senha e pedido.** Limites por IP ajudam, mas robôs distribuídos os contornam. *Ação:* Cloudflare Turnstile ou Vercel BotID nas ações públicas; CAPTCHA do Supabase Auth.
**M2. Firewall/WAF da plataforma não verificado.** Não consigo ver a Vercel. *Ação:* regras de rate limit no Vercel Firewall para `/cadastro`, `/api/*` e ações; ter o "Attack Challenge Mode" à mão para ataques.
**M3. `bodySizeLimit: 30mb` vale para TODAS as Server Actions, inclusive as públicas** (checkout, cupom, login). Qualquer visitante pode enviar corpos grandes a esses endpoints (custo e memória). Além disso, a Vercel costuma limitar o corpo de funções a ~4,5 MB, então o envio de 5 imagens de 5 MB de uma vez **provavelmente já falha em produção** (a confirmar). *Ação:* upload direto ao Storage com URL assinada e limite pequeno nas ações.
**M4. Webhooks (Asaas/Mercado Pago) sem limite por IP para tokens inválidos, e sem tamanho mínimo imposto ao token** (a função só rejeita acima de 512). *Ação:* mínimo de 32 caracteres ao salvar o token e limite de falhas por IP.
**M5. Cadastro revela se o e-mail já existe** ("já cadastrado"). Recuperação de senha responde igual exista ou não. *Ação:* mensagem neutra e aviso por e-mail.
**M6. Bloqueio de conta por terceiros:** o limite por conta (10 tentativas/10 min) permite que um atacante impeça a vítima de entrar durante a janela. Trade-off aceitável; mitigar com CAPTCHA após N falhas em vez de bloqueio total.

### Baixa
- **B1. `/api/csp-report` lia o corpo inteiro antes de checar o tamanho.** **Corrigido nesta PR** (leitura limitada, com testes).
- **B2. CSP:** estilos com `'unsafe-inline'` (documentado e de risco menor que script); sem `form-action` explícito.
- **B3. IP do cliente = primeiro item de `x-forwarded-for`:** correto na Vercel (definido pela plataforma). Se a hospedagem mudar, passa a ser falsificável.
- **B4. Dependências:** produção tem 5 vulnerabilidades *moderadas* na cadeia de build do Sentry (`@sentry/webpack-plugin`, `glob`, `minimatch`: DoS/regex em tempo de build, não no servidor). As 2 *críticas* e 1 *alta* do `npm audit` completo estão em **`vitest`/`tinypool`/`brace-expansion`** (ferramentas de teste; não são enviadas à produção, mas o CI e quem roda testes devem usar versões corrigidas). *Ação:* atualizar `vitest` e `@sentry/nextjs` em PR própria com o CI como rede.
- **B5. Sentry:** `sendDefaultPii` não habilitado (padrão desligado); amostragem de 10% em produção. Revisar se o DSN público aceita só a origem do site.

## Não pude verificar (precisa do dono)
Supabase: confirmação de e-mail obrigatória, política de senha e proteção contra senhas vazadas, CAPTCHA, limites de e-mail do Auth, buckets reais do Storage, estado real das RLS em produção, MFA para o master. Vercel: variáveis de ambiente, proteção de deployments/Preview, firewall, domínio e HSTS. GitHub: proteção da branch main, revisão obrigatória, varredura de segredos ativa. **Backups** (não aprovados).
Recomendo ainda: **2FA obrigatório** nas contas GitHub, Vercel e Supabase e um teste de invasão externo depois da homologação.

## Prioridade sugerida
1. Homologar e implantar #6 → migration 1 → migration 2 (fecha A1).
2. Confirmar `SUPABASE_SERVICE_ROLE_KEY` e decidir falhar fechado em autenticação (A2).
3. Ligar Turnstile/BotID e regras do Vercel Firewall (M1, M2).
4. Corrigir upload e `bodySizeLimit` (M3).
5. Atualizar dependências (B4) e endurecer webhooks (M4).

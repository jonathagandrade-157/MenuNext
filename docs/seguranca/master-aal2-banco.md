# Segundo fator (AAL2) exigido pelo banco — painel Master

**Por que existe.** A exigência de MFA do aplicativo (`MASTER_REQUIRE_MFA`) só protege as páginas e ações do app. As funções
administrativas também estão acessíveis **diretamente pela API do Supabase**: quem tiver o JWT de um administrador em AAL1 (só
a senha) poderia chamar `master_*`, `update_platform_settings` etc. sem passar pelo app. Esta migration fecha essa porta no
próprio banco. **O MFA do Master só deve ser considerado completo quando esta camada estiver aplicada e homologada.**

## O que muda
Migration `20261107000000_platform_admin_require_aal2.sql` (**não aplicada em lugar nenhum**):
- `public.is_platform_admin()` — a **única** definição usada por todas as funções e políticas do Master — passa a exigir `aal = 'aal2'` no JWT quando a exigência está ligada. Mesma assinatura e privilégios.
- `platform_security` (tabela fechada, 1 linha, **padrão desligado**): ninguém a lê nem altera direto, nem o administrador.
- `platform_set_require_aal2(boolean)`: liga/desliga; exige administrador **e AAL2 na sessão que altera** (anti-trancamento: só liga quem acabou de provar que o segundo fator funciona).
- `platform_get_require_aal2()` (leitura, só administrador) e `platform_admin_state()` (`not_admin` | `mfa_required` | `admin`), usado pelo app para encaminhar o administrador em AAL1 a `/master-mfa` em vez de tratá-lo como "não administrador".
- App: `resolveMasterAccess` (usa `platform_admin_state`; sem a migration cai no comportamento anterior), cartão **Segurança** em `/master/configuracoes` para ligar/desligar.

## Impacto nas outras funções administrativas (com a exigência LIGADA)
Todas passam a negar um JWT de administrador sem AAL2 (`not_authorized`), inclusive chamadas diretas à API:
`master_dashboard_stats`, `master_list_restaurants`, `master_get_restaurant`, `master_get_restaurant_trial`, `master_extend_trial`, `master_metrics`, `master_audit_list`, `master_set_billing_block`, `master_set_subscription_provider`, `update_platform_settings`, políticas de planos/assinaturas e de auditoria que usam `is_platform_admin()`. **Não afeta:** lojistas (OWNER/STAFF), checkout público, webhooks, cron e rotinas `service_role` (não usam `is_platform_admin()`), nem o acesso de dono do banco (SQL Editor).
Efeito colateral conhecido: a coluna "autor" da auditoria classifica como "plataforma" a ação de quem passa em `is_platform_admin()`; um administrador em AAL1 deixa de ser classificado assim — mas também deixa de conseguir agir.

## Ativação (nesta ordem; em homologação primeiro)
1. Aplique a migration no ambiente de **homologação** (pré-voo/pós-voo como as demais). Nada muda: a exigência nasce desligada.
2. No Supabase (Auth → MFA) confirme que TOTP está habilitado. Entre como administrador, abra `/master-mfa` e cadastre o autenticador. Teste sair e entrar de novo e verificar o código.
3. Em `/master/configuracoes → Segurança` (sessão **já em duas etapas**) clique em *Ligar exigência*.
4. Teste: com a sessão em AAL1 (login novo, sem verificar o código), chame uma RPC administrativa direto pela API (`POST /rest/v1/rpc/master_dashboard_stats`) — deve responder erro; após verificar o código, deve responder dados.
5. Só então repita em produção, **após aprovação** e backup, e ligue `MASTER_REQUIRE_MFA=true` no ambiente.

## Recuperação de acesso (perdeu o autenticador)
Quem tem acesso de **dono do banco** (SQL Editor do Supabase / role `postgres`) executa:
```sql
update public.platform_security set require_aal2 = false;
```
O administrador volta a entrar com a senha; remova o fator perdido e cadastre outro em `/master-mfa`, depois religue. Mantenha **pelo menos duas pessoas** com acesso de dono ao banco e os contatos do procedimento. Desligar o `MASTER_REQUIRE_MFA` na Vercel e reimplantar cobre apenas a camada do aplicativo.
Rollback completo da migration: `supabase/rollback/20261107000000_platform_admin_require_aal2.down.sql` (restaura `is_platform_admin()` original).

## O que está comprovado e o que NÃO está
- **Comprovado (PostgreSQL sintético, 49 verificações em `supabase/tests/platform_mfa.sql`):** desligada nada muda; só administrador em AAL2 liga; ligada, `aal1`, `aal0`, `AAL2`, `aal3`, vazio ou **ausência da claim** negam; as RPCs administrativas diretas são negadas em AAL1 e funcionam em AAL2; não administrador nunca vira administrador; a tabela é inacessível; a recuperação por SQL funciona. Mutação (retirar a exigência da função) é detectada pela suíte (12 falhas).
- **NÃO comprovado:** que o JWT real emitido pelo Supabase Auth traz a claim `aal` e a atualiza após `challengeAndVerify` (é o comportamento documentado do Supabase, mas o ambiente real está pausado e o laboratório **simula** o JWT); o comportamento com expiração/renovação de sessão; o cadastro do TOTP no Auth real. **Isso exige teste em homologação** (passo 4 acima) antes de qualquer declaração de proteção efetiva.
- **Risco residual:** o primeiro cadastro de autenticador é protegido só pela senha (ver `master-isolado.md`).

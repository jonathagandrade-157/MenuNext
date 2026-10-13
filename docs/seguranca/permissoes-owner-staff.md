# Permissões por papel: OWNER e STAFF

Resumo do modelo de permissões da loja e de onde cada regra é aplicada. A regra vale **no banco**, nas **RPCs** e nas
**Server Actions**; esconder botão ou página não é a defesa.

## Regras

| Ação | OWNER | STAFF |
|---|---|---|
| Ver pedidos, KDS, cardápio e dados da própria loja | sim | sim |
| Avançar e cancelar pedidos da própria loja (estados permitidos) | sim | sim |
| Venda de balcão | sim | sim |
| **Ligar/desligar a disponibilidade** de produto e de adicional | sim | **sim** (e só isso) |
| Criar, editar, excluir, reordenar produto, adicional, grupo, categoria, combo; preços e fotos | sim | não |
| Cupons, zonas de entrega, horários | sim | não |
| Pagamentos (chave Pix), aparência, informações, delivery, contato | sim | não |
| Pausar e reabrir a loja | sim | não |
| Convidar, remover membro, ver convites (token) | sim | não |
| Arquivos da loja (logo, capa, fotos) | sim | não |
| Plano e assinatura | sim | não |

Papel `MANAGER` não existe no schema (`restaurant_members.role` aceita só `OWNER` e `STAFF`).

## Camadas (nenhuma depende do frontend)

1. **`is_restaurant_owner(restaurant_id)`**: função de papel, no mesmo molde de `is_restaurant_member`.
2. **RLS por papel**: escrita direta só do OWNER nas tabelas de configuração e de cardápio. O `UPDATE` de `products` e
   `addons` continua visível ao membro, limitado pela camada 3.
3. **Trigger de guarda** (`guard_owner_only_writes`) nas tabelas de cardápio. Vale também para RPCs `SECURITY DEFINER`, que
   ignoram a RLS. O STAFF só passa em um `UPDATE` de `products`/`addons` quando **nenhuma coluna além de `is_available`**
   (e `updated_at`) muda. Chamadas sem JWT (`service_role`, migrations, SQL Editor) não são afetadas.
4. **RPCs de cardápio** exigem OWNER explicitamente (`not_authorized` antes de qualquer escrita).
5. **`restaurant_invites`** (contém o token do convite) só é legível pelo OWNER.
6. **Storage** (`restaurant-assets`): escrita só do OWNER.
7. **Server Actions**: `requireOwnerAction()` (`src/lib/tenant.ts`) em toda ação administrativa. As únicas ações liberadas
   ao STAFF são `toggleProductAvailableAction` e `toggleAddonAvailableAction`.

O que **não** muda: `create_order` (checkout público e venda de balcão) escreve em `coupons.uses_count` como
`SECURITY DEFINER`; por isso `coupons` tem só RLS por papel, **sem** trigger de guarda. Quem é STAFF e também compra na
própria loja não é barrado.

## Testes

| Arquivo | O que prova |
|---|---|
| `supabase/tests/roles_owner_staff.sql` | 222 verificações: catálogo, ataques do STAFF por escrita direta e por RPC (inclusive por função `SECURITY DEFINER` sem checagem de papel), controles positivos do OWNER, regras de pedidos, outras personas, checkout e cupom |
| `supabase/tests/tenant_isolation.sql` | isolamento entre lojas (inalterado) |
| `supabase/tests/restaurant_billing_columns.sql` | colunas de cobrança (o caso de STAFF da fase 3 passou para a suíte de papéis) |
| `src/lib/actions/ownerGuard.test.ts` | cobertura estática: toda ação exportada tem guarda declarado; comportamento: STAFF não grava nada nas ações administrativas e segue ligando/desligando disponibilidade |

Cada ataque precisa ser barrado pela **camada esperada**; um erro de outro tipo é reportado como inconclusivo. Rode as
suítes SQL só em banco isolado (elas criam usuários em `auth.users`; tudo é desfeito no fim).

## Privilégios de tabela (anon e authenticated)

Migration separada: `supabase/migrations/20261009030000_harden_table_privileges.sql`. Retira `TRUNCATE`, `TRIGGER` e
`REFERENCES` de `anon` e `authenticated` em todas as tabelas de `public` e faz as tabelas futuras criadas por quem roda
as migrations já nascerem sem eles. São privilégios que nenhuma funcionalidade usa e que não passam pela RLS nem pelos
triggers de linha. Não muda `SELECT`, `INSERT`, `UPDATE` e `DELETE` (a migration confere a contagem antes e depois e
aborta se mudar), nem `service_role`.

`supabase/tests/table_privileges.sql` (122 verificações) garante: nenhum dos três privilégios para `anon`,
`authenticated` ou `PUBLIC` (tabela ou coluna); tabela nova já nasce sem eles; o DML que o app usa continua concedido
(inclusive o `UPDATE` por coluna de `restaurants` e `profiles`); `service_role` mantém tudo; e `TRUNCATE` recebe
`permission denied` na prática. Se uma tabela passar a ser criada por outro papel com privilégios padrão amplos, esse
teste acusa.

## Observações para quem for estender

- Ação nova em arquivo de `src/lib/actions/`: o teste `ownerGuard.test.ts` falha até ela (ou o arquivo) ser classificada.
- Tabela nova de configuração ou cardápio: escreva políticas com `is_restaurant_owner` e, se houver RPC
  `SECURITY DEFINER` que escreva nela, ligue o trigger `guard_owner_only_writes`.
- RPC nova que o STAFF precise executar: use `is_restaurant_member` de propósito e documente aqui.

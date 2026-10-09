# Reconciliação do histórico de migrations (repositório × Supabase)

Atualizado em 2026-10-09. Este documento **investiga e propõe**. Nada aqui foi executado no banco: nenhuma migration foi
reaplicada, nenhum SQL já executado foi modificado e não foi usado `supabase db push` nem `supabase migration repair`.

## 1. Resumo

| Item | Valor |
|---|---|
| Migrations registradas no Supabase (projeto MenuNext) | 48 |
| Arquivos em `supabase/migrations/` | 47 |
| Nomes locais presentes no Supabase | 47 de 47 |
| Existe só no Supabase | `master_restaurants_fix_onboarding_step_cast` (`20261007165612`) |
| Mesmo nome **e** mesma versão | 8 |
| Mesmo nome, **versão diferente** (a renomear) | 39 |
| Texto idêntico ao registrado no Supabase | 8 de 47 |
| SQL **executável** idêntico (ignorando comentários e espaços) | 42 de 47 (as 5 exceções estão na seção 4) |
| Ordem cronológica local × Supabase | diferente em 2 arquivos (seção 6) |
| Schema e permissões da produção × banco reconstruído a partir dos arquivos | idênticos (seção 3) |

## 2. Causa da divergência

O Supabase registra, para cada migration, uma **versão** (timestamp) atribuída no instante em que ela é aplicada pelo
painel ou pelo MCP (`apply_migration`). Os arquivos do repositório receberam um timestamp escolhido por quem os escreveu,
sem relação com o instante da aplicação. Por isso o **nome** coincide e a **versão** quase sempre não. Exemplo: o arquivo
`20261009000000_protect_restaurant_billing_columns.sql` é a versão `20261009152007` no Supabase.

Além disso, vários arquivos foram escritos ou editados **depois** de a migration já estar aplicada (alguns trazem o
cabeçalho "reconstruído a partir do estado real do banco"). Daí os textos diferirem, mesmo com o mesmo efeito.

## 3. O schema é equivalente? Produção × banco reconstruído a partir dos arquivos

Reconstruí o banco aplicando os arquivos num PostgreSQL 17.10 local e comparei com a produção, primeiro com os
arquivos como estão e depois com os arquivos **já renomeados** para as versões do Supabase (Opção A, seção 8). O resultado
foi o mesmo nas duas reconstruções:

| Item | Produção | Reconstruído | Resultado |
|---|---|---|---|
| Colunas (271) | `d3894ce0…` | `d3894ce0…` | idêntico |
| Constraints (184, sem `NOT NULL`) | `540299ed…` | `540299ed…` | idêntico |
| Índices (90) | `cb18eac3…` | `cb18eac3…` | idêntico |
| Políticas RLS (77, `public` + `storage`) | `5b20dc1b…` | `5b20dc1b…` | idêntico |
| Triggers (16) | `048bd3e3…` | `048bd3e3…` | idêntico |
| ACL de tabelas (27, com RLS) | `58fbd385…` | `58fbd385…` | idêntico |
| ACL por coluna (38) | `1647ad60…` | `1647ad60…` | idêntico |
| ACL de execução das 57 funções | por função | por função | idêntico (0 diferenças) |
| Definição das 57 funções | por função | por função | código executável idêntico (abaixo) |

Funções, comparadas uma a uma: 51 idênticas; 3 divergem só por caracteres `\r` no texto armazenado na produção
(`create_order`, `create_restaurant_invite`, `is_valid_document`; linha a linha, 0 linhas diferentes); 3 divergem só por
comentários que o arquivo do repositório tem e a produção não (`move_category`, `update_product`,
`process_asaas_webhook`). O banco não tem diferença de comportamento.

## 4. O texto das migrations

O Supabase guarda o texto de cada migration aplicada. Comparei o texto registrado com cada arquivo local:

- **8 de 47** arquivos têm texto idêntico (ignorando `\r` e espaço final).
- Ignorando **comentários e espaços**, o SQL executável é idêntico em **42 de 47**.
- As **5 exceções** diferem no SQL, mas sem efeito no resultado final (confirmado pela impressão digital da seção 3):

| Arquivo local | Diferença em relação ao que foi aplicado |
|---|---|
| `20260910190000_add_public_checkout_and_orders.sql` | 2 linhas: o arquivo tem o apelido `as o` e `returning o.id, o.public_id`, que são a correção de uma ambiguidade registrada em outra migration (`fix_create_order_public_id_ambiguity`) |
| `20260911140000_add_delivery_config_and_cancellation.sql` | 1 linha: forma do `revoke` sobre `cancel_order` |
| `20260912120500_drop_stale_create_order_overload.sql` | `drop function if exists` no arquivo; `drop function` na aplicada |
| `20260912122212_restrict_cancel_order_from_anon.sql` | reconstrução: o arquivo faz `revoke execute … from anon`; a aplicada faz `revoke all … from public, anon` e `grant execute … to authenticated` |
| `20261007020000_master_restaurants.sql` | tem a correção do `::integer` embutida (ver seção 5) |

## 5. A migration que existe só no Supabase

`20261007165612_master_restaurants_fix_onboarding_step_cast`: o texto registrado tem **uma única instrução**, um
`create or replace function public.master_get_restaurant(uuid)` igual à versão final (com `r.onboarding_step::integer`, porque
a coluna é `smallint` e a função devolve `integer`), seguido de `revoke` e `grant` de execução. A correção **já está
embutida** em `20261007020000_master_restaurants.sql`, que foi editado no lugar em vez de virar um arquivo novo; por isso um
banco criado a partir dos arquivos já nasce com a função correta (confirmado: `master_get_restaurant` idêntica à produção).

**Como representá-la no repositório (proposta):** um arquivo **marcador**,
`20261007165612_master_restaurants_fix_onboarding_step_cast.sql`, só com comentários e **nenhum SQL executável**. Assim a
versão existe localmente e o histórico local fica com as mesmas 48 versões do Supabase, sem duplicar a definição da
função em dois lugares (o que criaria risco de divergência futura). Alternativas consideradas:

- Copiar o SQL registrado num arquivo novo: fiel ao histórico, mas duplica a função e, num banco novo, a define duas vezes.
- Não representar: deixa o histórico local sem uma versão que existe no Supabase, o que a CLI acusaria.

## 6. Ordem cronológica

No Supabase, `restrict_cancel_order_from_anon` (`20260912122212`) foi aplicada **antes** de `add_distance_based_delivery_fee`
(`20260912124322`) e `drop_stale_create_order_overload` (`20260912124340`). Nos arquivos locais atuais, essas duas vêm antes
(`20260912120000` e `20260912120500`). Os objetos são independentes (`cancel_order` e `create_order`) e a impressão digital é
idêntica nas duas ordens. Depois da Opção A as duas passam a ter as versões `20260912124322` e `20260912124340`, e a ordem
local fica igual à do Supabase.

## 7. O que a CLI do Supabase faria hoje (comportamento esperado, **não executado**)

`supabase db push` e `supabase migration list` comparam **versões**. Com 39 versões diferentes, a CLI trataria os arquivos
locais como "não aplicados" e as versões do Supabase como "sem arquivo", e recusaria o push pedindo reparo. Um reparo feito
sem cuidado (`migration repair`) poderia marcar como aplicado o que não foi. Hoje isso é inofensivo, porque as migrations são
aplicadas pelo MCP ou painel, mas **não rode `supabase db push` nem `supabase db reset` contra a produção** antes de reconciliar.

Integração Supabase ↔ GitHub: nos commits do GitHub aparece apenas o status `Vercel`, sem nenhum do Supabase, o que sugere
(sem provar) que o deploy automático de migrations não está ligado. Confirme em *Project Settings → Integrations → GitHub*; se
estiver ligado com "Deploy to production", faça esta reconciliação **antes** de enviar novas migrations para a `main`.

## 8. Opção A (recomendada): renomear os arquivos locais para as versões do Supabase

**Status: preparada e verificada, mas NÃO executada.** Será feita num commit separado
(`chore: alinhar versões das migrations com o Supabase`), depois de autorizada.

O que ela faz, e só isso:

1. `git mv` de 39 arquivos para a versão registrada no Supabase (o **nome** depois da versão não muda).
2. Adiciona o arquivo marcador da seção 5 (só comentários).
3. Não toca no banco, não reaplica nada e **não altera o conteúdo** de nenhum arquivo.

Verificações feitas numa **cópia temporária** do repositório (o repositório real não foi alterado):

| Verificação | Resultado |
|---|---|
| Mapa de renomeação | 39 renomeações válidas, nomes preservados, nenhum destino em conflito |
| Conteúdo (SHA-256 antes e depois) | idêntico nos 39 arquivos |
| Lista final de arquivos × histórico do Supabase | **igual** (48 arquivos, mesma ordem cronológica) |
| Versões duplicadas | nenhuma |
| Banco reconstruído com os arquivos renomeados × produção | **mesmo schema e mesmas permissões** (seção 3) |

## 9. Outras opções

- **Opção B, `supabase migration repair`:** altera metadados da produção para casar com os nomes locais. Não recomendada: mexe
  na produção para resolver um problema que existe só nos nomes dos arquivos.
- **Opção C, não reconciliar:** aceitável enquanto só o MCP ou o painel aplicarem migrations, mas deixa uma armadilha para
  quem usar a CLI.

## 10. Riscos e o que não fazer

- Não rode `supabase db push`, `supabase db reset` nem `supabase migration repair` contra a produção.
- Não edite o **conteúdo** de uma migration já aplicada; só comentários, e documente. Mudanças reais viram migration nova.
- Ao renomear, confira o SHA-256 antes e depois (a Opção A faz isso).
- Se a integração GitHub do Supabase estiver ligada, reconcilie antes de enviar migrations novas para a `main`.

## 11. Mapeamento completo (arquivo local → versão registrada no Supabase)

| Arquivo local | Versão no Supabase | Situação |
|---|---|---|
| `20260909191417_initial_tenant_schema.sql` | `20260909191531` | renomear |
| `20260909191500_harden_function_privileges.sql` | `20260909191648` | renomear |
| `20260909193700_optimize_rls_initplan.sql` | `20260909193627` | renomear |
| `20260910125916_add_document_and_trial_eligibility.sql` | `20260910125916` | igual |
| `20260910130254_restrict_profiles_update_columns.sql` | `20260910130254` | igual |
| `20260910135213_require_document_on_signup.sql` | `20260910135213` | igual |
| `20260910141440_add_restaurant_assets_storage.sql` | `20260910141526` | renomear |
| `20260910143836_add_categories.sql` | `20260910143914` | renomear |
| `20260910155451_add_products_category_and_fields.sql` | `20260910155611` | renomear |
| `20260910161510_add_addon_groups_and_addons.sql` | `20260910161709` | renomear |
| `20260910163000_add_combos.sql` | `20260910164225` | renomear |
| `20260910170000_add_public_storefront_read_access.sql` | `20260910171614` | renomear |
| `20260910170500_fix_public_read_restaurant_visibility_check.sql` | `20260910171752` | renomear |
| `20260910180000_add_public_addon_read_access.sql` | `20260910210847` | renomear |
| `20260910190000_add_public_checkout_and_orders.sql` | `20260910212911` | renomear |
| `20260910193000_fix_create_order_public_id_ambiguity.sql` | `20260910213528` | renomear |
| `20260911130000_add_order_status_transitions.sql` | `20260911121937` | renomear |
| `20260911140000_add_delivery_config_and_cancellation.sql` | `20260911145518` | renomear |
| `20260911145810_expose_delivery_fields_public_restaurant_v2.sql` | `20260911145810` | igual |
| `20260912120000_add_distance_based_delivery_fee.sql` | `20260912124322` | renomear (ordem: no Supabase vem depois de `restrict_cancel_order_from_anon`) |
| `20260912120500_drop_stale_create_order_overload.sql` | `20260912124340` | renomear (ordem: no Supabase vem depois de `restrict_cancel_order_from_anon`) |
| `20260912122212_restrict_cancel_order_from_anon.sql` | `20260912122212` | igual |
| `20260914120000_require_delivery_zip_and_state.sql` | `20260914164046` | renomear |
| `20260922003037_add_restaurant_invites.sql` | `20260922003037` | igual |
| `20260922003309_add_get_restaurant_members.sql` | `20260922003309` | igual |
| `20260922003452_disambiguate_invite_already_member_error.sql` | `20260922003452` | igual |
| `20260924010000_add_platform_admin.sql` | `20260924013232` | renomear |
| `20260924020000_add_platform_settings.sql` | `20260924133243` | renomear |
| `20260924030000_add_customer_notes.sql` | `20260924224409` | renomear |
| `20260925000000_add_pix_qrcode_fields.sql` | `20260925040715` | renomear |
| `20260928000000_add_restaurant_contact_info.sql` | `20260928155221` | renomear |
| `20260929000000_add_business_hours_periods.sql` | `20260929235839` | renomear |
| `20260930000000_add_delivery_zones.sql` | `20260930002947` | renomear |
| `20260930010000_add_theme_primary_color.sql` | `20260930005757` | renomear |
| `20260930020000_add_remove_restaurant_member.sql` | `20260930081745` | renomear |
| `20261001000000_add_coupons.sql` | `20261001151532` | renomear |
| `20261001010000_add_counter_orders.sql` | `20261001163150` | renomear |
| `20261001020000_add_subscription_billing.sql` | `20261001172257` | renomear |
| `20261001030000_block_overdue_orders.sql` | `20261001172922` | renomear |
| `20261007000000_guard_duplicate_subscription.sql` | `20261007163242` | renomear |
| `20261007010000_harden_billing.sql` | `20261007164615` | renomear |
| `20261007020000_master_restaurants.sql` | `20261007165517` | renomear |
| `20261007030000_master_dashboard_stats.sql` | `20261007172314` | renomear |
| `20261008000000_trial_expiry_block.sql` | `20261008222833` | renomear |
| `20261008010000_master_metrics.sql` | `20261008225940` | renomear |
| `20261008020000_master_trial_extension.sql` | `20261008232735` | renomear |
| `20261009000000_protect_restaurant_billing_columns.sql` | `20261009152007` | renomear (P0-01) |

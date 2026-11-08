# Variantes (tamanhos/versões) — implantação e reversão

Entrega conjunta de duas PRs e duas migrations:

| Ordem | Migration | O que faz | PR |
| --- | --- | --- | --- |
| 1 | `20261105040000_product_variants.sql` | cadastro de variantes no painel (tabela e RPCs) | #16 |
| 2 | `20261108000000_order_item_variants.sql` | `create_order` cobra a variante; loja lê as variantes; `order_variants_supported()` | #27 |

**Estado:** nenhuma das duas foi aplicada em produção. Não existe projeto Supabase de homologação do MenuNext
(os projetos visíveis são o MenuNext de produção, pausado, e projetos de outros produtos). As validações abaixo
foram feitas em **ambiente sintético** (PostgreSQL + PostgREST, a mesma API do Supabase), não no Supabase.

## Trava de compatibilidade

A loja e o PDV só mostram variantes quando o banco responde `order_variants_supported() = true`. Essa função é
criada pela **mesma** migration que ensina `create_order` a cobrar a variante. Por isso não existe combinação de
código e banco em que o cliente escolhe uma opção e o pedido a ignora:

| Código publicado | Banco | Resultado (testado) |
| --- | --- | --- |
| novo | sem as migrations | cardápio e pedido de sempre; painel mostra "variantes indisponíveis" (4/4) |
| novo | só a migration 1 | variantes cadastráveis, mas **escondidas** na loja/PDV; pedido pelo preço do produto (4/4) |
| novo | as duas | variantes completas (26/26) |
| atual (`main`) | as duas, sem variantes cadastradas | tudo como hoje (3/3) |
| novo | as duas → rollback aplicado com o app no ar | volta ao preço do produto; pedidos antigos preservados (7/7) |

Única combinação perigosa: **código antigo + variantes já cadastradas**. Produto com variantes não é pedido
(`variant_required`), porque o código antigo não envia a escolha. A ordem abaixo evita isso.

## Implantação (homologação primeiro, depois produção)

Pré-requisitos: projeto Supabase de homologação do MenuNext com dados sintéticos, e backup/ponto de restauração
da produção aprovado. Nada disso existe hoje.

1. **Homologação:** aplicar a migration 1 e depois a 2, no SQL Editor ou com `supabase db push`, nesta ordem.
2. Rodar as suítes `supabase/tests/product_variants.sql` e `order_item_variants.sql`: cada uma termina com
   `RESULTADO: OK`.
3. Publicar o código (#16 + #27) num preview ligado à homologação e repetir o roteiro manual: cadastrar opção,
   pedir pela loja e pelo PDV, desligar opção, conferir o pedido no painel.
4. **Produção** (só com aprovação): aplicar a migration 1 e depois a 2. Enquanto o código antigo estiver no ar,
   **ninguém cadastra variantes**: o código antigo não tem a tela, então isso só aconteceria por SQL manual.
5. Integrar #16 e #27 na `main`. O deploy na Vercel é automático.
6. Conferir: `select public.order_variants_supported();` → `true`; abrir a loja de um cliente piloto; fazer um
   pedido de teste e cancelá-lo.

A ordem 4 → 5 (banco antes do código) também é segura ao contrário (código antes do banco), pela trava. A ordem
recomendada é banco primeiro, porque assim o painel nunca mostra "variantes indisponíveis" em produção.

## Reversão

Sempre **o banco antes do código**: com o banco revertido, o código novo esconde as variantes sozinho.

1. Rodar `supabase/rollback/20261108000000_order_item_variants.down.sql`. Devolve `create_order` **idêntico**
   (md5 conferido) e remove a leitura pública, `order_variants_supported()` e as colunas `variant_id`/`variant_name`.
2. Se quiser remover também o cadastro: `supabase/rollback/20261105040000_product_variants.down.sql` (apaga as
   variantes cadastradas).
3. Só então, se necessário, reverter o código na Vercel (Instant Rollback) ou com um revert na `main`.

O histórico é preservado: o nome gravado no item do pedido ("Pizza — Média") e o preço cobrado não mudam. Só se
perde a ligação `variant_id`/`variant_name` quando o rollback 1 remove essas colunas.

## Evidências (ambiente sintético, dados falsos)

- Suítes SQL (`scripts/checkout-lab`, PostgreSQL 16 local; o CI usa o 17): 1.223 verificações, das quais 29 de
  `order_item_variants.sql` e 42 de `product_variants.sql`.
- Stack de ponta a ponta (`scripts/stack-lab`: PostgreSQL + PostgREST 12 + gateway + build de produção +
  Chromium/Playwright):
  - `e2e-variants.cjs` — 26/26: "a partir de"; seleção obrigatória; opção desligada bloqueada; preço da variante;
    checkout real com total do servidor; sacola adulterada (variante de outra loja com preço R$ 1, variante
    desligada, sacola antiga sem variante) recusada com mensagem; API com preço forjado, variante de outro
    produto ou loja, id malformado; painel do OWNER (criar, editar, desligar); PDV da equipe (seleção
    obrigatória, venda gravada); histórico após apagar a variante.
  - `e2e-compat.cjs` — os cenários da tabela acima.
- **Não feito:** validação num projeto Supabase de homologação (não existe) e em produção.

# Referência visual (Stitch)

Conteúdo original do arquivo `stitch_menunext_saas_platform.zip`, preservado sem alterações em `./stitch/`. Cada tela exportada é uma pasta com `code.html` (protótipo Tailwind/HTML estático) e `screen.png` (captura). Não é código de produção — é referência visual para as páginas em `src/app/`.

Ver `stitch/modern_gastronomy_b2b_saas/DESIGN.md` para o design system gerado automaticamente pelo Stitch. **A especificação oficial de design do produto (cores, tipografia, espaçamento) é a do relatório da Sprint 0, não a deste arquivo** — há divergência de paleta entre os dois (ver relatório).

## Mapa telas → rotas

| Pasta em `stitch/` | Screen | Rota na aplicação |
|---|---|---|
| `menunext_fanpage_oficial_landing_page_saas_b2b` | SCREEN_48 | `/` |
| `menunext_etapa_02_cadastro_do_lojista` | SCREEN_47 | `/cadastro` |
| `menunext_etapa_03_passo_1_dados_do_restaurante_e_url` | SCREEN_45 | `/onboarding/passo-1` |
| `menunext_etapa_03_passo_2_endere_o_cep_e_confirma_o_no_mapa` | SCREEN_44 | `/onboarding/passo-2` |
| `menunext_etapa_03_passo_3_formas_de_atendimento` | SCREEN_43 | `/onboarding/passo-3` |
| `menunext_etapa_03_passo_4_configura_o_de_delivery` | SCREEN_42 | `/onboarding/passo-4` |
| `menunext_etapa_03_passo_5_hor_rios_de_funcionamento` | SCREEN_41 | `/onboarding/passo-5` |
| `menunext_etapa_03_passo_6_formas_de_pagamento` | SCREEN_40 | `/onboarding/passo-6` |
| `menunext_etapa_03_passo_7_primeiro_produto` | SCREEN_38 | `/onboarding/passo-7` |
| `menunext_loja_pronta_publica_o_p_s_onboarding` | SCREEN_37 | `/onboarding/loja-pronta` |
| `menunext_loja_p_blica_home_do_restaurante` | SCREEN_30 | `/loja/[slug]` |
| `menunext_loja_p_blica_sacola_do_pedido` | SCREEN_29 | `/loja/[slug]/sacola` |
| `menunext_loja_p_blica_checkout` | SCREEN_28 | `/loja/[slug]/checkout` |
| `menunext_loja_p_blica_pedido_confirmado` | SCREEN_27 | `/loja/[slug]/pedido/[orderId]` |
| `menunext_loja_p_blica_rastreamento_do_pedido` | SCREEN_26 | `/loja/[slug]/pedido/[orderId]/rastreamento` |
| `menunext_dashboard_do_restaurante` | SCREEN_18 | `/painel` |
| `menunext_painel_lojista_pedidos_kanban_operacional` | SCREEN_25 | `/painel/pedidos` |
| `menunext_frente_de_caixa` | SCREEN_17 | `/painel/caixa` |
| `menunext_cozinha_kds` | SCREEN_16 | `/painel/kds` |
| `menunext_painel_do_lojista_categorias` | SCREEN_35 | `/painel/categorias` |
| `menunext_painel_do_lojista_produtos` | SCREEN_34 | `/painel/produtos` |
| `menunext_painel_do_lojista_novo_produto` | SCREEN_33 | `/painel/produtos/novo` |
| `menunext_painel_do_lojista_adicionais_e_complementos` | SCREEN_32 | `/painel/adicionais` |
| `menunext_painel_do_lojista_combos` | SCREEN_31 | `/painel/combos` |
| `menunext_painel_lojista_delivery_e_taxas` | SCREEN_23 | `/painel/delivery` |
| `menunext_painel_lojista_hor_rios_de_funcionamento` | SCREEN_22 | `/painel/horarios` |
| `menunext_painel_lojista_pagamentos` | SCREEN_21 | `/painel/pagamentos` |
| `menunext_painel_lojista_apar_ncia_da_loja` | SCREEN_20 | `/painel/aparencia` |
| `menunext_painel_lojista_clientes` | SCREEN_19 | `/painel/clientes` |
| `menunext_painel_lojista_marketing_e_promo_es` | SCREEN_15 | `/painel/marketing` |
| `menunext_painel_lojista_usu_rios_e_permiss_es` | SCREEN_14 | `/painel/usuarios` |
| `menunext_painel_lojista_configura_es_gerais` | SCREEN_13 | `/painel/configuracoes` |
| `menunext_painel_lojista_plano_e_assinatura` | SCREEN_12 | `/painel/plano` |
| `menunext_painel_lojista_ajuda_e_manual_de_uso` | SCREEN_11 | `/painel/ajuda` |
| `menunext_painel_master_dashboard` | SCREEN_10 | `/master` |
| `menunext_painel_master_detalhes_do_restaurante` | SCREEN_9 | `/master/restaurantes/[id]` |
| `menunext_painel_master_assinaturas` | SCREEN_8 | `/master/assinaturas` |
| `menunext_painel_master_configura_es` | SCREEN_7 | `/master/configuracoes` |
| `menunext_painel_master_usu_rios` | SCREEN_6 | `/master/usuarios` |
| `menunext_painel_master_m_tricas` | SCREEN_5 | `/master/metricas` |
| `menunext_painel_master_suporte` | SCREEN_4 | `/master/suporte` |
| `menunext_painel_master_auditoria_e_logs` | SCREEN_2 | `/master/auditoria` |
| `menunext_painel_do_lojista_estrutura_base` | (sem número — shell de referência) | `/painel/layout.tsx` (conceitual) |
| `menunext_brand_logo` | — logo | `public/menunext-logo.svg` |
| `modern_gastronomy_b2b_saas` | — DESIGN.md exportado | referência (divergente da paleta oficial) |
| `close_up_delicious_artisanal_beef_burger_...` | — foto de banco de imagens | referência de imagem de produto |
| `whatsapp_image_2026_09_08_at_23.11.47.jpeg` | — imagem avulsa | não identificada / sem uso definido |

`/master/restaurantes` (listagem) foi criada na aplicação sem uma tela correspondente no export — apenas o detalhe (SCREEN_9) veio no ZIP.

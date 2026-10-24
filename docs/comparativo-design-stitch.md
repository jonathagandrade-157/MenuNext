# Comparativo Stitch × sistema — telas restantes

Data: 21/10/2026. Base: `design-reference/stitch/*/screen.png` e `code.html` (as 6 imagens corrompidas foram lidas pelo `code.html`).

Como ler: cada item que o mockup tem e o sistema não tem está num destes grupos.

- **A — só layout.** O dado e a função já existem; falta reorganizar a tela. Faço direto.
- **B — recurso novo sem banco de dados.** Usa dados que já existem ou só cálculo/tela. Faço direto.
- **C — exige banco de dados (migration) ou serviço externo.** Decisão sua, item por item.
- **D — não recomendo.** Inventado no mockup ou sem sentido para o produto hoje.

Regra do projeto: só dado real. Nada de número, botão ou status que não funcione.

## Painel do lojista

### Configurações gerais (+ Informações, que não tem mockup próprio)
| Item do mockup | Grupo | Observação |
|---|---|---|
| Nome, nome comercial, WhatsApp, e-mail, bio num único card | A | Hoje nome/endereço ficam em Informações e contato/bio em Configurações; unificar |
| Link da loja e QR Code com "Baixar PNG" | B | A biblioteca de QR já existe |
| Dados da conta MenuNext (plano, titular) | B | Vem da assinatura |
| Tempo padrão de preparo | A/B | Conferir onde o KDS lê esse valor hoje |
| Endereço com mapa e raio | C | Precisa de serviço de mapas (chave e custo) |
| Botão flutuante de WhatsApp ligável/desligável | C | Coluna nova em `restaurants` |
| "Aceitar pedidos só no horário" | D | Decidido antes: o banco aplica sempre; expor o desligar é risco |
| "Checkout sem cadastro" ligável | D | O cliente nunca precisa de conta; o interruptor não tem efeito |
| Zona de perigo "desativar restaurante" | D | Já existe pausar/reabrir; desativar de vez é destrutivo |

### Plano e assinatura
| Item | Grupo | Observação |
|---|---|---|
| Faixa do teste com barra de dias restantes | B | `trial_ends_at` existe |
| Cartão do plano atual (valor, próxima cobrança, status) | B | Dados da assinatura |
| Histórico de faturas | C | Corrigido: `billing_payments` não tem acesso para o lojista; exige uma função nova no banco |
| Comparativo de planos com lista de recursos | C | Hoje o plano só tem nome, valor e descrição; falta coluna de recursos |
| Cancelar assinatura | A/B | Conferir se a ação existe; a cobrança está desligada, não dá para testar |
| Tabelas Start/Pro/Plus do mockup | D | São planos inventados; valem os que o master cadastrar |

### Aparência
| Item | Grupo | Observação |
|---|---|---|
| Prévia do celular/desktop ao vivo | B | Reaproveita os componentes da loja |
| Checagem de contraste da cor (WCAG) | B | Só cálculo |
| Sugestão de paleta a partir do logo | B | Cálculo no navegador; salvar só a cor principal que já existe |
| "Restaurar padrão" | B | |
| Cores secundária, de fundo e de texto | C | Colunas novas |
| Banner promocional (texto, botão, liga/desliga) | C | Colunas novas |
| Produtos em destaque na home | C | Marcação e ordem de destaque |
| Informações visíveis no rodapé (toggles) e Instagram | C | Colunas novas |
| Ordem das categorias | A | Já existe em Categorias; só linkar |

### Marketing
| Item | Grupo | Observação |
|---|---|---|
| Abas e filtros (Ativas/Agendadas/Pausadas) nos cupons | A/B | Conferir se o cupom tem início/fim |
| Promoções automáticas (dias, horários, itens, pedido mínimo) | C | Tabela nova e regra aplicada no pedido |
| Destaques da loja | C | Mesma base do destaque da Aparência |

### Caixa (PDV)
| Item | Grupo | Observação |
|---|---|---|
| Grade de produtos com busca e categorias | A | Conferir o que a venda atual já traz |
| Cálculo de troco e atalhos de teclado (F2, F4, F8, F9) | B | |
| Seleção de cliente na venda | B | Usa a base de clientes |
| Abrir e fechar caixa (sessão, valor inicial, vendas do turno) | C | Tabela de sessões de caixa |

### Usuários
| Item | Grupo | Observação |
|---|---|---|
| Cartões de totais, abas Todos/Ativos/Pendentes e busca | B | |
| Cartão do proprietário e gaveta de convite | A | |
| Permissões por módulo (Pedidos, Caixa, Cozinha, Cardápio…) | C — **não recomendo agora** | Hoje há dois papéis (proprietário e equipe), aplicados no banco; granular exige reescrever as regras de segurança |
| Último acesso | C | Exige consulta administrativa ao serviço de login |
| Atividade recente da equipe | C | Exige registro de auditoria |

### Ajuda
| Item | Grupo | Observação |
|---|---|---|
| Busca unificada e atalhos por tema | já existe | Corrigido: a busca já estava implementada |
| Checklist de sucesso com progresso | já existe | Corrigido: já aparece na Ajuda |
| Guias rápidos e guia lateral passo a passo | A + texto | Conteúdo precisa ser escrito |
| Fotos nos guias | D | Não temos as imagens |
| "Manual completo", "suporte VIP" | D | Não existem |

## Painel master
| Tela | O que o mockup tem a mais | Grupo |
|---|---|---|
| Dashboard | Trials em andamento detalhados, restaurantes recentes, "requer atenção" | B |
| Dashboard | GMV (volume transacionado) | C leve (estender a função de estatísticas do banco) |
| Dashboard | Atividade recente em tempo real | C (registro de eventos) |
| Métricas | Distribuição por plano, restaurantes em destaque | B |
| Métricas | "Insights automáticos por IA" | D (inventado) |
| Detalhes do restaurante | Atividade da loja e auditoria administrativa | C (registro de auditoria) |
| Assinaturas | MRR por plano, saúde, requer atenção, lista com ações | B (hoje sem dado: cobrança desligada) |
| Usuários master | Lista de operadores, convite | C (convite de master) ; colunas 2FA e IP: D |
| Auditoria e logs | Tela inteira (hoje é placeholder de 13 linhas) | C — tabela de auditoria |
| Configurações | Regras de cadastro (período de teste), segurança | C (período de teste configurável) |
| Suporte | Tela de chamados (hoje placeholder) | C — **não recomendo** até haver demanda real |

## Onboarding (7 passos + loja pronta)
As 8 telas existem. Diferenças vistas nos mockups, ainda não conferidas uma a uma no código:

| Item | Grupo |
|---|---|
| Passo 2: confirmação da localização no mapa | C (serviço de mapas) |
| Passo 3: "Consumir no local" | C — não existe salão no produto |
| Passo 4: entrega por bairros/personalizado e raio | A (as zonas já existem) |
| Passo 5: preenchimento express (copiar horários) e tempo de preparo | B (copiar horários já existe no painel) |
| Passo 6: pergunta de troco e Vale Refeição | C |
| Passo 7: criar categoria dentro do passo | B |
| Loja pronta: QR Code e checklist | B |

## Minha recomendação de decisão (grupo C)

Vale a pena, nesta ordem, para o restaurante vender mais ou o master operar:
1. **Banner promocional + produtos em destaque** (Aparência/Marketing): aumenta venda, baixo risco.
2. **Promoções automáticas** (Marketing).
3. **Abrir/fechar caixa** (Caixa), se algum piloto vender no balcão.
4. **Registro de auditoria** (alimenta Auditoria do master, atividade da equipe e atividade da loja).

Não recomendo agora: permissões por módulo, tela de suporte/chamados, mapa no cadastro.

## Andamento (21/10/2026)

Feito e em produção, grupos A e B:

- Aparência: prévia da loja ao vivo, aviso de contraste e cores sugeridas pelo logo.
- Configurações: QR Code com Baixar PNG e Imprimir cartaz no cartão da loja; cartão Dados da conta MenuNext.
- Plano: faixa do teste com dias restantes e barra de progresso.
- Usuários: totais com ícone, abas Todos/Equipe/Convites e busca.
- Onboarding: copiar horário para todos os dias (passo 5) e nome da primeira categoria (passo 7).
- Master: card de restaurantes recentes no dashboard.

Falta nos grupos A e B: reestruturar visualmente Caixa, Marketing (só cupons), Informações/Configurações num único card, Ajuda (guias), master (Assinaturas, Métricas, Detalhes) e as demais telas do onboarding. Grupo C aguarda decisão.

### Grupo C (21/10/2026)

- **Banner promocional e produtos em destaque:** feito e em produção (migration `featured_products_and_banner`).
- **Registro de auditoria:** feito e em produção (migration `audit_log`): tela Auditoria do master com paginação e filtro por loja, "Atividade recente" em Usuários e "Atividade recente da loja" no detalhe do restaurante no master. Registra só ações de pessoas em tabelas de configuração, só nomes de campos alterados, nunca valores.
- Falta: sessões de caixa e promoções automáticas.

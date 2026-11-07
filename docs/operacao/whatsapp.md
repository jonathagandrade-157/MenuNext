# Aviso ao cliente pelo WhatsApp

## O que existe hoje (sem custo, sem credencial, sem migration)

No detalhe do pedido (Painel → Pedidos, Kanban e Histórico) há o botão **"Avisar no WhatsApp"**. Ele abre o
WhatsApp de quem está usando o painel (celular ou WhatsApp Web) com a mensagem do **status atual** já escrita:

| Status | Mensagem (resumo) |
| --- | --- |
| Recebido | "Recebemos seu pedido #N na Loja. Total: R$ X." + link de acompanhamento |
| Confirmado / Em preparo | "...foi confirmado" / "...está sendo preparado" + link |
| Pronto | retirada: "pronto para retirada"; entrega: "logo sai para entrega" + link |
| Saiu para entrega | "...saiu para entrega" + link |
| Entregue / Retirado | agradecimento (sem link) |
| Cancelado | aviso e convite para responder (sem link) |

* **Nada é enviado sozinho.** A pessoa revisa e toca em enviar. O MenuNext não fala com o WhatsApp, não guarda
  nada novo e não manda o telefone a nenhum serviço: o link `wa.me` só abre o app.
* Telefone inválido (ex.: venda de balcão sem telefone) → o botão não aparece.
* O link de acompanhamento é a página pública do pedido (`/loja/<slug>/pedido/<id>/rastreamento`), a mesma que
  o cliente já recebe ao finalizar. O id do pedido não é adivinhável.
* Código: `src/lib/whatsappNotify.ts` (testes em `whatsappNotify.test.ts`).

## Envio automático (NÃO implementado — exige decisão e credenciais)

Mandar a mensagem sozinho a cada mudança de status exige a **WhatsApp Business Platform (Cloud API)** da Meta:

1. Conta Meta Business **verificada** e número exclusivo para a API (não pode estar em uso no app comum).
2. **Modelos de mensagem aprovados** pela Meta (mensagem iniciada pela empresa só sai por modelo).
3. **Cobrança por conversa** pela Meta (custo real — fora do que está aprovado hoje).
4. **Consentimento (opt-in) do cliente** registrado no checkout e opção de parar de receber (LGPD).
5. Token da API guardado só no servidor (nunca no navegador), webhook de status e fila de reenvio.

Enquanto esses itens não estiverem decididos e disponíveis, o recurso fica **desligado** (não há código de
envio automático no repositório).

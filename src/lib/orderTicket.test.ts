import { describe, expect, it } from "vitest";
import { buildOrderTicketHtml, escapeHtml } from "./orderTicket";
import type { OrderWithItems } from "./orders";

const order = (extra: Partial<OrderWithItems> = {}): OrderWithItems => ({
  id: "o1",
  restaurant_id: "r1",
  public_id: "p1",
  order_number: 1048,
  customer_name: "João da Silva",
  customer_phone: "(11) 99999-9999",
  fulfillment_type: "delivery",
  delivery_zip: "04087003",
  delivery_street: "Alameda dos Anapurus",
  delivery_number: "1200",
  delivery_complement: "Apto 42B",
  delivery_neighborhood: "Moema",
  delivery_city: "São Paulo",
  delivery_state: "SP",
  delivery_reference: "Próximo à padaria",
  payment_method: "cash",
  change_for: 100,
  observation: "Sem cebola, por favor",
  subtotal: 44.9,
  delivery_fee: 5,
  coupon_id: null,
  coupon_code: null,
  promotion_id: null,
  promotion_name: null,
  discount_amount: 0,
  total: 49.9,
  status: "received",
  confirmed_at: null,
  preparing_at: null,
  ready_at: null,
  out_for_delivery_at: null,
  delivered_at: null,
  picked_up_at: null,
  created_at: "2026-10-20T22:14:00.000Z",
  updated_at: "2026-10-20T22:14:00.000Z",
  order_items: [
    {
      id: "i1",
      product_name: "Almoço Executivo",
      unit_price: 40.9,
      quantity: 1,
      observation: "ao ponto",
      subtotal: 44.9,
      order_item_addons: [{ id: "a1", addon_name: "Batata frita", unit_price: 4, subtotal: 4 }],
    },
  ],
  ...extra,
});

describe("escapeHtml", () => {
  it("escapa os cinco caracteres perigosos", () => {
    expect(escapeHtml(`<img src=x onerror="alert('1')"> & co`)).toBe(
      "&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt; &amp; co"
    );
  });
});

describe("buildOrderTicketHtml", () => {
  it("traz os dados reais do pedido (número, cliente, itens, adicionais, totais, pagamento)", () => {
    const html = buildOrderTicketHtml(order(), "Next Burger");
    expect(html).toContain("Next Burger — Pedido #1048");
    expect(html).toContain("João da Silva");
    expect(html).toContain("(11) 99999-9999");
    expect(html).toContain("Almoço Executivo");
    expect(html).toContain("+ Batata frita");
    expect(html).toContain("Alameda dos Anapurus, 1200");
    expect(html).toContain("Ref.: Próximo à padaria");
    expect(html).toContain("Sem cebola, por favor");
    expect(html).toContain("Pagamento: Dinheiro (troco para");
    expect(html).toMatch(/Total<\/span><span>R\$\s?49,90/);
  });

  it("nunca deixa o texto do cliente virar HTML (nome, endereço, observações, adicionais)", () => {
    const hostile = `<script>alert(1)</script>`;
    const html = buildOrderTicketHtml(
      order({
        customer_name: hostile,
        delivery_street: hostile,
        delivery_reference: hostile,
        observation: hostile,
        order_items: [
          {
            id: "i1",
            product_name: hostile,
            unit_price: 1,
            quantity: 1,
            observation: hostile,
            subtotal: 1,
            order_item_addons: [{ id: "a1", addon_name: hostile, unit_price: 0, subtotal: 0 }],
          },
        ],
      }),
      hostile
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("retirada não mostra endereço nem taxa de entrega", () => {
    const html = buildOrderTicketHtml(order({ fulfillment_type: "pickup", delivery_fee: 0, payment_method: "pix", change_for: null }));
    expect(html).toContain("Retirada");
    expect(html).not.toContain("Alameda dos Anapurus");
    expect(html).not.toContain("<span>Entrega</span>");
    expect(html).toContain("Pagamento: Pix");
    expect(html).not.toContain("troco");
  });

  it("mostra cupom só quando há desconto e omite observação ausente", () => {
    const withCoupon = buildOrderTicketHtml(order({ coupon_code: "BEMVINDO", discount_amount: 5 }));
    expect(withCoupon).toContain("Cupom (BEMVINDO)");
    const withPromotion = buildOrderTicketHtml(order({ promotion_id: "p1", promotion_name: "Happy hour", discount_amount: 8 }));
    expect(withPromotion).toContain("Promoção Happy hour");
    expect(withPromotion).not.toContain("Cupom");
    const plain = buildOrderTicketHtml(order({ observation: null }));
    expect(plain).not.toContain("Cupom");
    expect(plain).not.toContain("Observação");
  });

  it("endereço incompleto não deixa vírgulas soltas", () => {
    const html = buildOrderTicketHtml(
      order({ delivery_street: null, delivery_number: null, delivery_complement: null, delivery_neighborhood: "Moema", delivery_reference: null })
    );
    expect(html).toContain("Moema");
    expect(html).not.toContain(">, <");
  });
});

import { describe, expect, it } from "vitest";
import { buildOrderNoticeText, buildTrackingUrl, buildWhatsAppLink, normalizeBrazilPhone, type OrderNoticeInput } from "./whatsappNotify";

describe("normalizeBrazilPhone", () => {
  it("aceita celular e fixo com ou sem máscara", () => {
    expect(normalizeBrazilPhone("(11) 98888-7777")).toBe("5511988887777");
    expect(normalizeBrazilPhone("11988887777")).toBe("5511988887777");
    expect(normalizeBrazilPhone("(21) 3333-4444")).toBe("552133334444");
  });
  it("não duplica o 55 e tira 0 / 00 da frente", () => {
    expect(normalizeBrazilPhone("+55 11 98888-7777")).toBe("5511988887777");
    expect(normalizeBrazilPhone("5511988887777")).toBe("5511988887777");
    expect(normalizeBrazilPhone("005511988887777")).toBe("5511988887777");
    expect(normalizeBrazilPhone("011988887777")).toBe("5511988887777");
    expect(normalizeBrazilPhone("552133334444")).toBe("552133334444");
  });
  it("recusa vazio, curto, longo, DDD inválido e celular sem 9", () => {
    for (const bad of ["", null, undefined, "123", "119888877771234", "(00) 98888-7777", "(10) 98888-7777", "11888887777", "1103334444"]) {
      expect(normalizeBrazilPhone(bad as string)).toBeNull();
    }
  });
});

const base: OrderNoticeInput = {
  status: "received", fulfillmentType: "pickup", customerName: "  Maria  da Silva ", storeName: "Pizzaria Boa",
  orderNumber: 42, total: 72.5, trackingUrl: "https://app.test/loja/boa/pedido/abc/rastreamento",
};

describe("buildOrderNoticeText", () => {
  it("cumprimenta pelo primeiro nome e cita número, loja e total ao receber", () => {
    const t = buildOrderNoticeText(base);
    expect(t).toMatch(/^Olá, Maria! Recebemos seu pedido #42 na Pizzaria Boa\. Total: R\$ 72,50\./);
    expect(t).toContain("Acompanhe: https://app.test/loja/boa/pedido/abc/rastreamento");
  });
  it("uma mensagem por status, respeitando entrega x retirada", () => {
    const by = (status: OrderNoticeInput["status"], fulfillmentType: OrderNoticeInput["fulfillmentType"] = "pickup") =>
      buildOrderNoticeText({ ...base, status, fulfillmentType });
    expect(by("confirmed")).toContain("foi confirmado");
    expect(by("preparing")).toContain("está sendo preparado");
    expect(by("ready")).toContain("pronto para retirada");
    expect(by("ready", "delivery")).toContain("logo sai para entrega");
    expect(by("out_for_delivery", "delivery")).toContain("saiu para entrega");
    expect(by("delivered", "delivery")).toContain("foi entregue");
    expect(by("picked_up")).toContain("foi retirado");
    expect(by("cancelled")).toContain("foi cancelado");
  });
  it("status final não manda link de acompanhamento", () => {
    for (const status of ["delivered", "picked_up", "cancelled"] as const) {
      expect(buildOrderNoticeText({ ...base, status })).not.toContain("Acompanhe");
    }
  });
  it("sem nome, sem loja e sem link continua legível", () => {
    const t = buildOrderNoticeText({ ...base, customerName: " ", storeName: null, trackingUrl: null, status: "confirmed" });
    expect(t).toBe("Olá! Seu pedido #42 foi confirmado.");
  });
});

describe("buildWhatsAppLink / buildTrackingUrl", () => {
  it("monta wa.me com texto codificado", () => {
    const link = buildWhatsAppLink("(11) 98888-7777", "Olá & tchau\nlinha 2");
    expect(link).toBe("https://wa.me/5511988887777?text=Ol%C3%A1%20%26%20tchau%0Alinha%202");
  });
  it("telefone inválido (ex.: venda de balcão sem telefone) não gera link", () => {
    expect(buildWhatsAppLink("", "x")).toBeNull();
  });
  it("link de acompanhamento só com origem e slug; partes codificadas", () => {
    expect(buildTrackingUrl("https://app.test/", "boa", "abc")).toBe("https://app.test/loja/boa/pedido/abc/rastreamento");
    expect(buildTrackingUrl("", "boa", "abc")).toBeNull();
    expect(buildTrackingUrl("https://app.test", null, "abc")).toBeNull();
    expect(buildTrackingUrl("https://app.test", "a/b", "c?d")).toBe("https://app.test/loja/a%2Fb/pedido/c%3Fd/rastreamento");
  });
});

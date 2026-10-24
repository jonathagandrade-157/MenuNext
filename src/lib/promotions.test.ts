import { describe, expect, it } from "vitest";
import {
  describeDiscount,
  describeSchedule,
  discountLabel,
  parsePromotion,
  pickBestDiscount,
  promotionStatus,
  readPromotionForm,
  toDateInput,
} from "./promotions";

function form(entries: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    if (Array.isArray(v)) v.forEach((x) => f.append(k, x));
    else f.set(k, v);
  }
  return f;
}

const base = { name: "Happy hour", discount_type: "percent", discount_value: "10" };

describe("readPromotionForm", () => {
  it("aceita o mínimo: nome, tipo e valor", () => {
    const r = readPromotionForm(form(base));
    expect(r).toEqual({
      ok: true,
      data: {
        name: "Happy hour",
        discount_type: "percent",
        discount_value: 10,
        min_order_value: null,
        starts_at: null,
        ends_at: null,
        weekdays: null,
        time_from: null,
        time_to: null,
      },
    });
  });

  it("aceita vírgula decimal e mínimo", () => {
    const r = readPromotionForm(form({ ...base, discount_type: "fixed", discount_value: "7,5", min_order_value: "40,00" }));
    expect(r.ok && r.data.discount_value).toBe(7.5);
    expect(r.ok && r.data.min_order_value).toBe(40);
  });

  it("recusa nome curto, tipo ausente, valor inválido e percentual acima de 100", () => {
    expect(readPromotionForm(form({ ...base, name: "A" })).ok).toBe(false);
    expect(readPromotionForm(form({ ...base, discount_type: "" })).ok).toBe(false);
    expect(readPromotionForm(form({ ...base, discount_value: "0" })).ok).toBe(false);
    expect(readPromotionForm(form({ ...base, discount_value: "abc" })).ok).toBe(false);
    expect(readPromotionForm(form({ ...base, discount_value: "101" })).ok).toBe(false);
    expect(readPromotionForm(form({ ...base, min_order_value: "-1" })).ok).toBe(false);
  });

  it("dias da semana: nenhum ou todos viram null; subconjunto fica ordenado e sem repetição", () => {
    expect((readPromotionForm(form(base)) as { ok: true; data: { weekdays: unknown } }).data.weekdays).toBeNull();
    const all = readPromotionForm(form({ ...base, weekdays: ["0", "1", "2", "3", "4", "5", "6"] }));
    expect(all.ok && all.data.weekdays).toBeNull();
    const some = readPromotionForm(form({ ...base, weekdays: ["5", "1", "5", "9", "x"] }));
    expect(some.ok && some.data.weekdays).toEqual([1, 5]);
  });

  it("horário: os dois ou nenhum, início antes do fim", () => {
    expect(readPromotionForm(form({ ...base, time_from: "18:00" })).ok).toBe(false);
    expect(readPromotionForm(form({ ...base, time_from: "22:00", time_to: "18:00" })).ok).toBe(false);
    expect(readPromotionForm(form({ ...base, time_from: "18:00", time_to: "18:00" })).ok).toBe(false);
    expect(readPromotionForm(form({ ...base, time_from: "25:00", time_to: "26:00" })).ok).toBe(false);
    const ok = readPromotionForm(form({ ...base, time_from: "18:00", time_to: "22:00" }));
    expect(ok.ok && [ok.data.time_from, ok.data.time_to]).toEqual(["18:00", "22:00"]);
  });

  it("período: datas viram instantes de São Paulo; término vale o dia inteiro", () => {
    const r = readPromotionForm(form({ ...base, starts_on: "2026-11-01", ends_on: "2026-11-10" }));
    expect(r.ok && r.data.starts_at).toBe("2026-11-01T03:00:00.000Z");
    expect(r.ok && r.data.ends_at).toBe("2026-11-11T02:59:59.000Z");
    expect(readPromotionForm(form({ ...base, starts_on: "2026-11-10", ends_on: "2026-11-01" })).ok).toBe(false);
    expect(readPromotionForm(form({ ...base, starts_on: "01/11/2026" })).ok).toBe(false);
  });

  it("um dia só (início = término) é válido", () => {
    expect(readPromotionForm(form({ ...base, starts_on: "2026-11-05", ends_on: "2026-11-05" })).ok).toBe(true);
  });
});

describe("exibição", () => {
  it("descreve o desconto", () => {
    expect(describeDiscount({ discount_type: "percent", discount_value: 10 })).toBe("10% OFF");
    expect(describeDiscount({ discount_type: "fixed", discount_value: 5 })).toMatch(/^R\$\s5,00 OFF$/);
  });

  it("descreve a agenda", () => {
    expect(describeSchedule({ weekdays: null, time_from: null, time_to: null, starts_at: null, ends_at: null })).toBe("Todos os dias · o dia todo");
    expect(
      describeSchedule({ weekdays: [1, 5], time_from: "18:00:00", time_to: "22:00:00", starts_at: "2026-11-01T03:00:00Z", ends_at: "2026-11-11T02:59:59Z" })
    ).toBe("Seg, Sex · 18:00–22:00 · de 01/11 a 10/11");
  });

  it("estado do ciclo de vida", () => {
    const now = new Date("2026-11-05T12:00:00Z");
    expect(promotionStatus({ is_active: false, starts_at: null, ends_at: null }, now)).toBe("off");
    expect(promotionStatus({ is_active: true, starts_at: "2026-11-06T00:00:00Z", ends_at: null }, now)).toBe("scheduled");
    expect(promotionStatus({ is_active: true, starts_at: null, ends_at: "2026-11-05T00:00:00Z" }, now)).toBe("ended");
    expect(promotionStatus({ is_active: true, starts_at: null, ends_at: null }, now)).toBe("on");
  });

  it("data para o input segue o fuso de São Paulo", () => {
    expect(toDateInput("2026-11-11T02:59:59.000Z")).toBe("2026-11-10");
    expect(toDateInput(null)).toBe("");
  });

  it("parse converte numeric (string) e array de dias", () => {
    const p = parsePromotion({
      id: "p", restaurant_id: "r", name: "N", discount_type: "fixed", discount_value: "5.00", min_order_value: "30.00",
      starts_at: null, ends_at: null, weekdays: [1, 5], time_from: "18:00:00", time_to: "22:00:00", is_active: true, created_at: "a", updated_at: "b",
    });
    expect(p.discount_value).toBe(5);
    expect(p.min_order_value).toBe(30);
    expect(p.weekdays).toEqual([1, 5]);
  });
});

describe("pickBestDiscount (mesma regra do create_order)", () => {
  it("promoção maior vence", () => {
    expect(pickBestDiscount(4, { name: "Dez", amount: 8 })).toEqual({ kind: "promotion", amount: 8, name: "Dez" });
  });
  it("empate fica com o cupom", () => {
    expect(pickBestDiscount(8, { name: "Dez", amount: 8 })).toEqual({ kind: "coupon", amount: 8 });
  });
  it("cupom maior vence", () => {
    expect(pickBestDiscount(40, { name: "Dez", amount: 8 })).toEqual({ kind: "coupon", amount: 40 });
  });
  it("só promoção, só cupom e nada", () => {
    expect(pickBestDiscount(0, { name: "Dez", amount: 8 }).kind).toBe("promotion");
    expect(pickBestDiscount(5, null).kind).toBe("coupon");
    expect(pickBestDiscount(0, null)).toEqual({ kind: "none", amount: 0 });
  });
});

describe("discountLabel", () => {
  it("cupom, promoção com nome e promoção sem nome (visão pública)", () => {
    expect(discountLabel({ coupon_code: "ABC", promotion_name: null })).toBe("Cupom (ABC)");
    expect(discountLabel({ coupon_code: null, promotion_name: "Happy hour" })).toBe("Promoção Happy hour");
    expect(discountLabel({ coupon_code: null })).toBe("Promoção");
  });
});

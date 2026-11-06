import { describe, expect, it } from "vitest";
import {
  changeToGiveBack,
  describeCashDifference,
  formatCashDateTime,
  formatCashTime,
  friendlyCashError,
  parseCashClosing,
  parseCashHistoryRow,
  parseCashSession,
  validateCashAmount,
} from "./cash";

describe("parse das linhas das RPCs", () => {
  it("cash_current: numeric vem como string e vira número", () => {
    const s = parseCashSession({
      session_id: "s1",
      opened_at: "2026-10-24T10:00:00Z",
      opened_by_name: "Equipe A",
      opening_amount: "100.00",
      orders_count: "3",
      total_sales: "60.00",
      cash_sales: "30.00",
      pix_sales: "20.00",
      card_sales: "10.00",
      expected_cash: "130.00",
    });
    expect(s).toMatchObject({ id: "s1", openingAmount: 100, ordersCount: 3, totalSales: 60, expectedCash: 130, openedByName: "Equipe A" });
  });

  it("cash_close: diferença negativa preservada", () => {
    const c = parseCashClosing({
      opened_at: "a",
      closed_at: "b",
      opening_amount: "100",
      orders_count: 3,
      total_sales: "60",
      cash_sales: "30",
      pix_sales: "20",
      card_sales: "10",
      expected_cash: "130",
      counted_cash: "125",
      difference: "-5",
    });
    expect(c.difference).toBe(-5);
    expect(c.countedCash).toBe(125);
  });

  it("histórico: sessão ainda aberta tem campos de fechamento nulos", () => {
    const h = parseCashHistoryRow({
      session_id: "s2",
      opened_at: "a",
      closed_at: null,
      opened_by_name: "Dono",
      closed_by_name: null,
      opening_amount: "0",
      counted_cash: null,
      expected_cash: null,
      difference: null,
      orders_count: 0,
      total_sales: "0",
      notes: null,
    });
    expect(h.closedAt).toBeNull();
    expect(h.difference).toBeNull();
    expect(h.notes).toBeNull();
  });
});

describe("friendlyCashError", () => {
  it("traduz os códigos conhecidos", () => {
    expect(friendlyCashError("cash_already_open")).toContain("já está aberto");
    expect(friendlyCashError("cash_not_open")).toContain("não está aberto");
    expect(friendlyCashError("invalid_amount")).toContain("valor válido");
    expect(friendlyCashError("not_authorized")).toContain("acesso");
  });

  it("não vaza erro técnico desconhecido", () => {
    const m = friendlyCashError("relation \"cash_sessions\" does not exist");
    expect(m).not.toContain("cash_sessions");
  });
});

describe("validateCashAmount", () => {
  it("aceita zero e valores com centavos, arredondando para 2 casas", () => {
    expect(validateCashAmount(0)).toEqual({ ok: true, value: 0 });
    expect(validateCashAmount(10.555)).toEqual({ ok: true, value: 10.56 });
  });

  it("recusa nulo, negativo, infinito e gigante", () => {
    expect(validateCashAmount(null).ok).toBe(false);
    expect(validateCashAmount(-1).ok).toBe(false);
    expect(validateCashAmount(Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(validateCashAmount(1e9).ok).toBe(false);
  });
});

describe("describeCashDifference", () => {
  it("batendo, sobrou e faltou", () => {
    expect(describeCashDifference(0)).toEqual({ kind: "ok", label: "Caixa batendo" });
    expect(describeCashDifference(0.001).kind).toBe("ok");
    expect(describeCashDifference(2.5)).toMatchObject({ kind: "over" });
    expect(describeCashDifference(2.5).label).toMatch(/^Sobrou R\$\s2,50$/);
    expect(describeCashDifference(-5).kind).toBe("short");
    expect(describeCashDifference(-5).label).toMatch(/^Faltou R\$\s5,00$/);
  });
});

describe("formatadores de data (fuso de São Paulo)", () => {
  it("converte UTC para o horário de Brasília, independente do fuso da máquina", () => {
    expect(formatCashTime("2026-10-24T13:32:00Z")).toBe("10:32");
    expect(formatCashDateTime("2026-10-24T13:32:00Z")).toContain("24/10");
    expect(formatCashDateTime("2026-10-24T13:32:00Z")).toContain("10:32");
    // 01:00 UTC ainda é o dia anterior em Brasília
    expect(formatCashDateTime("2026-10-25T01:00:00Z")).toContain("24/10");
  });
});

describe("changeToGiveBack", () => {
  it("troco = recebido - total; null se não cobre ou vazio", () => {
    expect(changeToGiveBack(50, 37.5)).toBe(12.5);
    expect(changeToGiveBack(37.5, 37.5)).toBe(0);
    expect(changeToGiveBack(20, 37.5)).toBeNull();
    expect(changeToGiveBack(null, 10)).toBeNull();
  });

  it("não sofre com ponto flutuante (0.1 + 0.2)", () => {
    expect(changeToGiveBack(10, 9.7)).toBe(0.3);
  });
});

describe("movimentações do caixa", () => {
  it("valida tipo, valor e motivo", async () => {
    const { validateCashMovement } = await import("./cash");
    expect(validateCashMovement("supply", 20, " troco ")).toEqual({ ok: true, value: { kind: "supply", amount: 20, reason: "troco" } });
    expect(validateCashMovement("withdrawal", 10.005, "x")).toMatchObject({ ok: true });
    for (const [k, a, r] of [["x", 5, "a"], ["supply", 0, "a"], ["supply", -1, "a"], ["supply", null, "a"], ["supply", NaN, "a"], ["supply", 1e9, "a"], ["supply", 5, "  "], ["supply", 5, "x".repeat(201)]] as const) {
      expect(validateCashMovement(k, a, r).ok, `${k}/${a}/${r.length}`).toBe(false);
    }
  });
  it("reconhece função ausente (migration não aplicada) e traduz erros", async () => {
    const { isMissingRpc, friendlyCashError } = await import("./cash");
    expect(isMissingRpc({ code: "PGRST202", message: "x" })).toBe(true);
    expect(isMissingRpc({ code: "42883" })).toBe(true);
    expect(isMissingRpc({ message: "Could not find the function public.cash_movements_list" })).toBe(true);
    expect(isMissingRpc({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingRpc(null)).toBe(false);
    expect(friendlyCashError("insufficient_cash")).toMatch(/maior que o dinheiro/);
  });
  it("getCashMovements: esconde o recurso sem a migration e propaga outros erros", async () => {
    const { getCashMovements } = await import("./cash");
    const fake = (error: unknown, data: unknown = null) => ({ rpc: async () => ({ data, error }) }) as never;
    expect(await getCashMovements(fake({ code: "PGRST202", message: "x" }))).toEqual({ available: false, rows: [] });
    await expect(getCashMovements(fake({ code: "XX000", message: "boom" }))).rejects.toBeTruthy();
    const ok = await getCashMovements(fake(null, [{ id: "1", kind: "withdrawal", amount: "12.5", reason: "cofre", created_by_name: "Ana", created_at: "2026-11-05T12:00:00Z" }]));
    expect(ok.available).toBe(true);
    expect(ok.rows[0]).toMatchObject({ kind: "withdrawal", amount: 12.5, reason: "cofre" });
  });
});

describe("vendas da sessão de caixa", () => {
  it("summarizeCashSales ignora canceladas e soma em centavos", async () => {
    const { summarizeCashSales } = await import("./cash");
    const sale = (orderNumber: number, paymentMethod: "cash" | "pix" | "card", total: number, status = "received") => ({ orderId: String(orderNumber), orderNumber, createdAt: "2026-11-05T12:00:00Z", paymentMethod, status, total });
    const r = summarizeCashSales([sale(1, "cash", 0.1), sale(2, "cash", 0.2), sale(3, "pix", 20), sale(4, "card", 99, "cancelled"), sale(5, "card", 10.5, "picked_up")]);
    expect(r).toEqual({ orders: 4, cancelled: 1, total: 30.8, byPayment: { cash: { orders: 2, total: 0.3 }, pix: { orders: 1, total: 20 }, card: { orders: 1, total: 10.5 } } });
    expect(summarizeCashSales([]).total).toBe(0);
  });
  it("getCashSessionSales: indisponível sem a migration, propaga outros erros, converte linhas", async () => {
    const { getCashSessionSales } = await import("./cash");
    const fake = (error: unknown, data: unknown = null) => ({ rpc: async () => ({ data, error }) }) as never;
    expect(await getCashSessionSales(fake({ code: "PGRST202", message: "x" }))).toEqual({ available: false, sales: [] });
    await expect(getCashSessionSales(fake({ code: "XX000", message: "boom" }))).rejects.toBeTruthy();
    const ok = await getCashSessionSales(fake(null, [{ order_id: "o", order_number: 7, created_at: "2026-11-05T12:00:00Z", payment_method: "pix", status: "received", total: "12.5" }]));
    expect(ok.sales[0]).toMatchObject({ orderNumber: 7, paymentMethod: "pix", total: 12.5 });
  });
});

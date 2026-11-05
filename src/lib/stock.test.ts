import { describe, expect, it } from "vitest";
import {
  buildStockRows,
  friendlyStockError,
  isUuid,
  parseStockInteger,
  stockStatus,
  summarizeStock,
  validateStockMovement,
} from "./stock";

describe("stockStatus", () => {
  it("saldo zero é sem estoque, mesmo com alerta desligado", () => {
    expect(stockStatus(0, 0)).toBe("out");
    expect(stockStatus(0, 10)).toBe("out");
  });
  it("no limite ou abaixo dele é baixo; acima é normal", () => {
    expect(stockStatus(5, 5)).toBe("low");
    expect(stockStatus(3, 5)).toBe("low");
    expect(stockStatus(6, 5)).toBe("ok");
  });
  it("limite 0 desliga o alerta de baixo", () => {
    expect(stockStatus(1, 0)).toBe("ok");
  });
});

describe("parseStockInteger", () => {
  it("aceita inteiros em texto ou número", () => {
    expect(parseStockInteger("12", false)).toEqual({ ok: true, value: 12 });
    expect(parseStockInteger(7, false)).toEqual({ ok: true, value: 7 });
    expect(parseStockInteger(" 3 ", false)).toEqual({ ok: true, value: 3 });
  });
  it("recusa decimal, negativo, vazio, notação científica e lixo", () => {
    for (const raw of ["1,5", "1.5", "-2", "", "  ", "1e3", "abc", "0x10", null, undefined, {}, NaN]) {
      expect(parseStockInteger(raw as never, true).ok, String(raw)).toBe(false);
    }
  });
  it("zero só quando permitido (ajuste e limite)", () => {
    expect(parseStockInteger("0", false).ok).toBe(false);
    expect(parseStockInteger("0", true)).toEqual({ ok: true, value: 0 });
  });
  it("respeita o máximo de 1.000.000", () => {
    expect(parseStockInteger("1000000", false).ok).toBe(true);
    expect(parseStockInteger("1000001", false).ok).toBe(false);
    expect(parseStockInteger("12345678", false).ok).toBe(false);
  });
});

describe("validateStockMovement", () => {
  it("monta a movimentação válida e normaliza a observação", () => {
    expect(validateStockMovement("entry", "10", "  compra  ")).toEqual({ ok: true, value: { kind: "entry", quantity: 10, note: "compra" } });
    expect(validateStockMovement("exit", 2, "   ")).toEqual({ ok: true, value: { kind: "exit", quantity: 2, note: null } });
  });
  it("ajuste aceita zero; entrada, saída e perda não", () => {
    expect(validateStockMovement("adjustment", "0", "").ok).toBe(true);
    for (const kind of ["entry", "exit", "loss"]) expect(validateStockMovement(kind, "0", "").ok).toBe(false);
  });
  it("recusa tipo desconhecido e observação longa", () => {
    expect(validateStockMovement("sumiu", "1", "").ok).toBe(false);
    expect(validateStockMovement(undefined, "1", "").ok).toBe(false);
    expect(validateStockMovement("entry", "1", "x".repeat(201)).ok).toBe(false);
    expect(validateStockMovement("entry", "1", "x".repeat(200)).ok).toBe(true);
  });
});

describe("isUuid", () => {
  it("só aceita UUID", () => {
    expect(isUuid("0b0e7c8e-7a47-4bd5-9f55-5f2d6a0f3c11")).toBe(true);
    expect(isUuid("1; drop table products")).toBe(false);
    expect(isUuid(123)).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});

describe("buildStockRows e summarizeStock", () => {
  const products = [
    { id: "p1", name: "Refrigerante", is_available: true },
    { id: "p2", name: "Batata", is_available: true },
    { id: "p3", name: "Açaí", is_available: false },
    { id: "p4", name: "Burger", is_available: true },
  ];
  const items = [
    { product_id: "p1", quantity: 2, low_threshold: 5 },
    { product_id: "p2", quantity: 0, low_threshold: 0 },
    { product_id: "p3", quantity: 40, low_threshold: 5 },
  ];

  it("ordena: sem estoque, baixo, normal, não controlado — e por nome dentro do grupo", () => {
    const rows = buildStockRows(products, items);
    expect(rows.map((r) => `${r.name}:${r.status}`)).toEqual(["Batata:out", "Refrigerante:low", "Açaí:ok", "Burger:untracked"]);
  });
  it("produto sem linha é não controlado e não conta nos alertas", () => {
    const rows = buildStockRows(products, items);
    const burger = rows.find((r) => r.productId === "p4")!;
    expect(burger.tracked).toBe(false);
    expect(summarizeStock(rows)).toEqual({ tracked: 3, low: 1, out: 1 });
  });
  it("ignora saldos de produtos que não existem mais na lista", () => {
    const rows = buildStockRows(products, [...items, { product_id: "ghost", quantity: 9, low_threshold: 0 }]);
    expect(rows).toHaveLength(4);
  });
});

describe("friendlyStockError", () => {
  it("traduz os códigos do banco e esconde o resto", () => {
    expect(friendlyStockError("insufficient_stock")).toMatch(/maior que o saldo/);
    expect(friendlyStockError("not_authorized")).toMatch(/proprietário/);
    expect(friendlyStockError('duplicate key value violates unique constraint "x"')).toBe("Não foi possível concluir agora. Tente novamente.");
  });
});

describe("integração com pedidos (rótulos e recurso opcional)", () => {
  it("venda e estorno têm rótulo, mas não são tipos manuais", async () => {
    const { STOCK_KIND_LABELS, validateStockMovement } = await import("./stock");
    expect(STOCK_KIND_LABELS.sale).toBe("Venda");
    expect(STOCK_KIND_LABELS.sale_reversal).toBe("Estorno de pedido");
    expect(validateStockMovement("sale", "1", "").ok).toBe(false);
    expect(validateStockMovement("sale_reversal", "1", "").ok).toBe(false);
  });
  it("getStockOverview esconde o interruptor sem a migration e propaga outros erros", async () => {
    const { getStockOverview } = await import("./stock");
    const make = (settingsError: unknown, settingsData: unknown = null) => ({
      from: (table: string) => {
        const result =
          table === "stock_settings"
            ? { data: settingsData, error: settingsError }
            : { data: [], error: null };
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "order", "limit"]) chain[m] = () => chain;
        chain.maybeSingle = async () => result;
        chain.then = (resolve: (v: unknown) => void) => resolve(result);
        return chain;
      },
    }) as never;
    expect((await getStockOverview(make({ code: "PGRST205", message: "x" }), "r")).autoDeduct).toBeNull();
    expect((await getStockOverview(make(null, { auto_deduct: true }), "r")).autoDeduct).toBe(true);
    expect((await getStockOverview(make(null, null), "r")).autoDeduct).toBe(false);
    await expect(getStockOverview(make({ code: "XX000", message: "boom" }), "r")).rejects.toBeTruthy();
  });
});

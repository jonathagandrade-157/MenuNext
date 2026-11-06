import { describe, expect, it } from "vitest";
import { computeStockReport, stockReportToCsv, type LedgerRow } from "./stockReport";

const START = "2026-11-02T03:00:00.000Z";
const END = "2026-11-04T03:00:00.000Z";
const m = (product_id: string, kind: LedgerRow["kind"], delta: number, balance_after: number, created_at: string): LedgerRow => ({ product_id, kind, delta, balance_after, created_at });

describe("computeStockReport", () => {
  const products = [{ id: "a", name: "Refri" }, { id: "b", name: "Batata" }, { id: "c", name: "Sem controle" }];
  const ledger = [
    m("a", "entry", 20, 20, "2026-11-01T12:00:00Z"), // antes do período
    m("a", "sale", -3, 17, "2026-11-02T12:00:00Z"),
    m("a", "sale", -2, 15, "2026-11-02T13:00:00Z"),
    m("a", "sale_reversal", 2, 17, "2026-11-02T14:00:00Z"),
    m("a", "loss", -1, 16, "2026-11-03T12:00:00Z"),
    m("a", "entry", 10, 26, "2026-11-03T13:00:00Z"),
    m("a", "adjustment", -2, 24, "2026-11-03T14:00:00Z"),
    m("a", "exit", -4, 20, "2026-11-04T12:00:00Z"), // depois do fim: ignorado
    m("b", "entry", 5, 5, "2026-11-03T10:00:00Z"), // primeira movimentação dentro do período
  ];
  const r = computeStockReport(products, ledger, START, END, new Map([["a", 20], ["b", 0]]));
  const a = r.rows.find((x) => x.productId === "a")!;

  it("saldo inicial, final e movimentos do período", () => {
    expect(a).toMatchObject({ opening: 20, closing: 24, entries: 10, exits: 0, losses: 1, sales: 5, reversals: 2, netSold: 3, adjustments: -2 });
  });
  it("fecha a conta: inicial + entradas - saídas - perdas - venda líquida + ajustes = final", () => {
    expect(a.opening + a.entries - a.exits - a.losses - a.netSold + a.adjustments).toBe(a.closing);
  });
  it("produto cuja primeira movimentação está no período começa de zero", () => {
    expect(r.rows.find((x) => x.productId === "b")).toMatchObject({ opening: 0, closing: 5, entries: 5 });
  });
  it("produto sem movimentação não aparece; ordena por venda líquida", () => {
    expect(r.rows.map((x) => x.productId)).toEqual(["a", "b"]);
  });
  it("status usa o saldo final e o limite", () => {
    expect(a.status).toBe("ok");
    expect(computeStockReport(products, ledger, START, END, new Map([["a", 30]])).rows[0].status).toBe("low");
  });
  it("sem movimento no período mantém o saldo anterior", () => {
    const rr = computeStockReport(products, ledger, "2026-12-01T03:00:00.000Z", "2026-12-02T03:00:00.000Z");
    const x = rr.rows.find((y) => y.productId === "a")!;
    expect(x).toMatchObject({ opening: 20, closing: 20, entries: 0, netSold: 0 });
  });
  it("totais", () => {
    expect(r.totals).toMatchObject({ entries: 15, netSold: 3, losses: 1, adjustments: -2 });
  });
});

describe("stockReportToCsv", () => {
  it("BOM, separador ; e proteção contra fórmula no nome", () => {
    const row = { ...computeStockReport([{ id: "a", name: "=cmd" }], [m("a", "entry", 1, 1, "2026-11-03T10:00:00Z")], START, END).rows[0] };
    const csv = stockReportToCsv([row]);
    expect(csv.startsWith("﻿Produto;Saldo inicial")).toBe(true);
    expect(csv.split("\r\n")[1].startsWith("'=cmd;")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { computeStoreOpenState, formatCurrencyBRL, type StoreOpenState } from "./store";
import type { BusinessHour } from "./tenant";

function hour(overrides: Partial<BusinessHour> & { day_of_week: number }): BusinessHour {
  return {
    restaurant_id: "r1",
    is_open: true,
    opens_at: "11:00",
    closes_at: "23:00",
    ...overrides,
  };
}

// Uma quarta-feira (day_of_week = 3) fixa, para controlar o "now" nos testes.
function wednesdayAt(hours: number, minutes = 0): Date {
  return new Date(2026, 8, 9, hours, minutes); // 2026-09-09 é uma quarta-feira
}

describe("computeStoreOpenState — TESTE 12 (loja fechada) e estados básicos", () => {
  it("TESTE 12: restaurante pausado é sempre 'paused', independente do horário", () => {
    const hours = [hour({ day_of_week: 3 })];
    expect(computeStoreOpenState("paused", hours, wednesdayAt(12))).toEqual<StoreOpenState>({ status: "paused" });
  });

  it("restaurante encerrado (closed) é sempre 'closed_permanently'", () => {
    const hours = [hour({ day_of_week: 3 })];
    expect(computeStoreOpenState("closed", hours, wednesdayAt(12))).toEqual<StoreOpenState>({
      status: "closed_permanently",
    });
  });

  it("restaurante em rascunho (draft) nunca aparece como aberto", () => {
    const hours = [hour({ day_of_week: 3 })];
    expect(computeStoreOpenState("draft", hours, wednesdayAt(12))).toEqual<StoreOpenState>({
      status: "closed_permanently",
    });
  });

  it("ativo dentro do horário de funcionamento do dia -> aberto", () => {
    const hours = [hour({ day_of_week: 3, opens_at: "11:00", closes_at: "23:00" })];
    expect(computeStoreOpenState("active", hours, wednesdayAt(15))).toEqual<StoreOpenState>({ status: "open" });
  });

  it("ativo antes do horário de abertura -> fechado por horário", () => {
    const hours = [hour({ day_of_week: 3, opens_at: "11:00", closes_at: "23:00" })];
    expect(computeStoreOpenState("active", hours, wednesdayAt(9))).toEqual<StoreOpenState>({ status: "closed_hours" });
  });

  it("ativo depois do horário de fechamento -> fechado por horário", () => {
    const hours = [hour({ day_of_week: 3, opens_at: "11:00", closes_at: "23:00" })];
    expect(computeStoreOpenState("active", hours, wednesdayAt(23, 30))).toEqual<StoreOpenState>({
      status: "closed_hours",
    });
  });

  it("ativo mas o dia está marcado como fechado (is_open = false) -> fechado por horário", () => {
    const hours = [hour({ day_of_week: 3, is_open: false })];
    expect(computeStoreOpenState("active", hours, wednesdayAt(15))).toEqual<StoreOpenState>({
      status: "closed_hours",
    });
  });

  it("ativo sem nenhum horário cadastrado para o dia -> fechado por horário", () => {
    const hours = [hour({ day_of_week: 4 })]; // só quinta, não quarta
    expect(computeStoreOpenState("active", hours, wednesdayAt(15))).toEqual<StoreOpenState>({
      status: "closed_hours",
    });
  });

  it("ativo sem NENHUM horário cadastrado (array vazio) -> fechado por horário, nunca 'Aberto' hardcoded", () => {
    expect(computeStoreOpenState("active", [], wednesdayAt(15))).toEqual<StoreOpenState>({ status: "closed_hours" });
  });

  it("horário que passa da meia-noite: aberto antes da meia-noite", () => {
    const hours = [hour({ day_of_week: 3, opens_at: "18:00", closes_at: "02:00" })];
    expect(computeStoreOpenState("active", hours, wednesdayAt(23))).toEqual<StoreOpenState>({ status: "open" });
  });

  it("horário que passa da meia-noite: aberto depois da meia-noite (já no dia seguinte)", () => {
    const hours = [hour({ day_of_week: 3, opens_at: "18:00", closes_at: "02:00" })];
    expect(computeStoreOpenState("active", hours, wednesdayAt(1))).toEqual<StoreOpenState>({ status: "open" });
  });

  it("horário que passa da meia-noite: fechado fora da janela", () => {
    const hours = [hour({ day_of_week: 3, opens_at: "18:00", closes_at: "02:00" })];
    expect(computeStoreOpenState("active", hours, wednesdayAt(10))).toEqual<StoreOpenState>({
      status: "closed_hours",
    });
  });
});

describe("formatCurrencyBRL", () => {
  it("formata como moeda brasileira", () => {
    expect(formatCurrencyBRL(89.9)).toBe(
      (89.9).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    );
  });
});

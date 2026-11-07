import { describe, expect, it } from "vitest";
import {
  claimNotification, connectionFromChannelStatus, countPendingOrders, planResync, shouldResync, titleWithPending,
} from "./orderSync";

const o = (id: string, status: "received" | "preparing" = "received") => ({ id, status });

describe("claimNotification", () => {
  it("só a primeira chamada por pedido notifica", () => {
    const set = new Set<string>();
    expect(claimNotification(set, "a")).toBe(true);
    expect(claimNotification(set, "a")).toBe(false);
    expect(claimNotification(set, "b")).toBe(true);
  });
});

describe("planResync", () => {
  it("avisa só os pedidos novos 'received' que chegaram durante a queda", () => {
    const notified = new Set(["a"]);
    const plan = planResync([o("a")], [o("a"), o("b"), o("c", "preparing")], notified);
    expect(plan.newOrderIds).toEqual(["b"]);
    expect(plan.orders.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
  it("resincronização repetida não avisa de novo", () => {
    const notified = new Set<string>();
    const first = planResync([], [o("b")], notified);
    const second = planResync([], [o("b")], notified);
    expect(first.newOrderIds).toEqual(["b"]);
    expect(second.newOrderIds).toEqual([]);
  });
  it("pedido já notificado por evento em tempo real não toca de novo na resincronização", () => {
    const notified = new Set<string>();
    claimNotification(notified, "x"); // evento INSERT chegou e buscou o pedido
    expect(planResync([], [o("x")], notified).newOrderIds).toEqual([]);
  });
  it("a lista buscada é a verdade: pedidos que saíram da esteira somem", () => {
    const plan = planResync([o("a"), o("gone")], [o("a")], new Set(["a", "gone"]));
    expect(plan.orders.map((x) => x.id)).toEqual(["a"]);
  });
  it("pedido que já passou de 'received' ao reconectar não é tratado como novo", () => {
    expect(planResync([], [o("z", "preparing")], new Set()).newOrderIds).toEqual([]);
  });
});

describe("shouldResync", () => {
  it("limita a frequência", () => {
    expect(shouldResync(null, 1000)).toBe(true);
    expect(shouldResync(1000, 2000)).toBe(false);
    expect(shouldResync(1000, 4000)).toBe(true);
  });
});

describe("título e conexão", () => {
  it("título com contador", () => {
    expect(titleWithPending("Pedidos", 0)).toBe("Pedidos");
    expect(titleWithPending("Pedidos", 3)).toBe("(3) Pedidos");
    expect(titleWithPending("Pedidos", 250)).toBe("(99+) Pedidos");
    expect(countPendingOrders([o("a"), o("b", "preparing"), o("c")])).toBe(2);
  });
  it("estado da conexão", () => {
    expect(connectionFromChannelStatus("SUBSCRIBED")).toBe("live");
    for (const s of ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]) expect(connectionFromChannelStatus(s)).toBe("reconnecting");
    expect(connectionFromChannelStatus("JOINING")).toBe("connecting");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { markNavigatedInStore, readNavigatedInStore, shouldUseHistoryBack, storeNavigationKey } from "./storeNavigation";

describe("voltar na loja", () => {
  it("usa o histórico só depois de navegar dentro da loja, com página anterior", () => {
    expect(shouldUseHistoryBack({ navigatedInStore: true, historyLength: 3 })).toBe(true);
    // abriu o produto por link (WhatsApp/aba nova): vai para o cardápio, nunca para fora do site
    expect(shouldUseHistoryBack({ navigatedInStore: false, historyLength: 5 })).toBe(false);
    expect(shouldUseHistoryBack({ navigatedInStore: true, historyLength: 1 })).toBe(false);
  });
});

describe("marca por aba e por loja", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("lê e grava no sessionStorage, separado por loja", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", { sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } });
    expect(readNavigatedInStore("loja-a")).toBe(false);
    markNavigatedInStore("loja-a");
    expect(readNavigatedInStore("loja-a")).toBe(true);
    expect(readNavigatedInStore("loja-b")).toBe(false);
    expect(store.get(storeNavigationKey("loja-a"))).toBe("1");
  });
  it("sem sessionStorage (bloqueado): não quebra e vai para o cardápio", () => {
    vi.stubGlobal("window", { get sessionStorage() { throw new Error("SecurityError"); } });
    expect(() => markNavigatedInStore("loja-a")).not.toThrow();
    expect(readNavigatedInStore("loja-a")).toBe(false);
  });
});

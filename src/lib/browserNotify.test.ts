import { describe, expect, it } from "vitest";
import { buildOrderNotification, loadNotifyPref, notifySupport, saveNotifyPref, shouldNotify } from "./browserNotify";

const o = (id: string, n: number, total: number, t: "delivery" | "pickup" | "counter" = "delivery") => ({ id, order_number: n, total, fulfillment_type: t });

describe("buildOrderNotification", () => {
  it("um pedido: número, tipo e total — sem dados do cliente", () => {
    const n = buildOrderNotification([{ ...o("a", 12, 45.5), customer_name: "Maria", customer_phone: "11999" } as never])!;
    expect(n.title).toBe("Novo pedido #12");
    expect(n.body).toMatch(/Entrega · R\$\s?45,50/);
    expect(JSON.stringify(n)).not.toMatch(/Maria|11999/);
    expect(n.tag).toBe("order-a");
  });
  it("vários pedidos viram um aviso só", () => {
    const n = buildOrderNotification([o("a", 1, 10), o("b", 2, 20.25, "pickup")])!;
    expect(n.title).toBe("2 novos pedidos");
    expect(n.body).toMatch(/30,25/);
    expect(n.tag).toBe("orders-batch");
  });
  it("lista vazia: nada", () => expect(buildOrderNotification([])).toBeNull());
});

describe("shouldNotify / notifySupport", () => {
  it("só com preferência ligada, permissão concedida e aba escondida", () => {
    expect(shouldNotify({ enabled: true, support: "granted", hidden: true })).toBe(true);
    for (const s of [{ enabled: false, support: "granted", hidden: true }, { enabled: true, support: "default", hidden: true }, { enabled: true, support: "denied", hidden: true }, { enabled: true, support: "unsupported", hidden: true }, { enabled: true, support: "granted", hidden: false }] as const) {
      expect(shouldNotify(s)).toBe(false);
    }
  });
  it("detecta suporte", () => {
    expect(notifySupport({})).toBe("unsupported");
    expect(notifySupport({ Notification: { permission: "granted" } })).toBe("granted");
    expect(notifySupport({ Notification: { permission: "denied" } })).toBe("denied");
    expect(notifySupport({ Notification: { permission: "default" } })).toBe("default");
  });
});

describe("preferência local", () => {
  it("padrão desligado; grava e lê; tolera armazenamento bloqueado", () => {
    const mem: Record<string, string> = {};
    const storage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => void (mem[k] = v) };
    expect(loadNotifyPref(storage)).toBe(false);
    saveNotifyPref(true, storage);
    expect(loadNotifyPref(storage)).toBe(true);
    saveNotifyPref(false, storage);
    expect(loadNotifyPref(storage)).toBe(false);
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadNotifyPref(broken)).toBe(false);
    expect(() => saveNotifyPref(true, broken)).not.toThrow();
  });
});

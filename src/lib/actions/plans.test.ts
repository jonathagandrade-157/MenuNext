import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  revalidate: vi.fn(),
  isMaster: { value: true },
  ready: { asaas: true, mercadopago: true } as Record<string, boolean>,
}));

vi.mock("next/cache", () => ({ revalidatePath: h.revalidate }));
vi.mock("@/lib/tenant", () => ({
  requireMasterPage: async () => {
    if (!h.isMaster.value) throw new Error("REDIRECT:/painel");
    return { supabase: { rpc: h.rpc } };
  },
}));
vi.mock("@/lib/billingConfig", () => ({ isBillingConfiguredFor: (provider: string) => h.ready[provider] ?? false }));

import { updateSubscriptionProviderAction } from "./plans";

beforeEach(() => {
  vi.clearAllMocks();
  h.isMaster.value = true;
  h.ready.asaas = true;
  h.ready.mercadopago = true;
  h.rpc.mockResolvedValue({ data: "mercadopago", error: null });
});

describe("updateSubscriptionProviderAction", () => {
  it("o Master escolhe um provedor configurado: o banco é chamado e as telas são revalidadas", async () => {
    const res = await updateSubscriptionProviderAction("mercadopago");
    expect(res).toEqual({ ok: true });
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("master_set_subscription_provider", { p_provider: "mercadopago" });
    expect(h.revalidate).toHaveBeenCalledWith("/master/assinaturas");
    expect(h.revalidate).toHaveBeenCalledWith("/painel/plano");
  });

  it("quem não é Master não chega ao banco", async () => {
    h.isMaster.value = false;
    await expect(updateSubscriptionProviderAction("mercadopago")).rejects.toThrow("REDIRECT");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("provedor desconhecido, vazio ou com texto estranho é recusado sem chamar o banco", async () => {
    for (const value of ["stripe", "", "ASAAS", "asaas ", "mercadopago;drop", "__proto__"]) {
      const res = await updateSubscriptionProviderAction(value);
      expect(res).toEqual({ ok: false, error: "Provedor inválido." });
    }
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("provedor sem credenciais não pode ser ativado (mensagem específica) e o banco não é chamado", async () => {
    h.ready.mercadopago = false;
    const mp = await updateSubscriptionProviderAction("mercadopago");
    expect(mp.ok).toBe(false);
    expect(mp.error).toMatch(/Mercado Pago/);
    h.ready.asaas = false;
    const asaas = await updateSubscriptionProviderAction("asaas");
    expect(asaas.ok).toBe(false);
    expect(asaas.error).toMatch(/Asaas/);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.revalidate).not.toHaveBeenCalled();
  });

  it("erro do banco vira mensagem amigável, sem detalhes, e nada é revalidado", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "not_authorized detalhe interno" } });
    const res = await updateSubscriptionProviderAction("asaas");
    expect(res).toEqual({ ok: false, error: "Não foi possível alterar o provedor. Tente novamente." });
    expect(JSON.stringify(res)).not.toContain("detalhe interno");
    expect(h.revalidate).not.toHaveBeenCalled();
  });
});

/**
 * Ensaio do checkout público com o CÓDIGO REAL das Server Actions contra um banco ISOLADO: PostgreSQL + PostgREST
 * locais (127.0.0.1). Nunca usa o Supabase real.
 *
 * NÃO roda na suíte normal: só com CHECKOUT_LAB_STATE=<caminho do lab-state.json>. O laboratório sobe com
 * `node lab-serve.mjs` (fora do repositório; ver docs/operacao/laboratorio-local.md). Use um laboratório RECÉM-INICIADO:
 * o teste semeia a própria loja e conta limites reais.
 *
 * O que muda em relação aos testes de unidade: aqui o banco, o PostgREST, as permissões (EXECUTE revogado) e o contador
 * de tentativas são REAIS; só `next/headers`, `next/cache` e `next/navigation` são simulados.
 */
import fs from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";

const statePath = process.env.CHECKOUT_LAB_STATE;
const enabled = Boolean(statePath && fs.existsSync(statePath));

type LabState = {
  supabaseUrl: string;
  anonKey: string;
  serviceKey: string;
  staffAJwt: string;
  ownerBJwt: string;
  ids: { ownerA: string; staffA: string; ownerB: string; rA: string; rB: string };
};
const state: LabState = enabled ? JSON.parse(fs.readFileSync(statePath!, "utf8")) : ({} as LabState);

const h = vi.hoisted(() => ({ ip: { value: "203.0.113.9" }, session: { jwt: "" as string, userId: "" as string } }));

if (enabled) {
  if (!/^http:\/\/127\.0\.0\.1:/.test(state.supabaseUrl)) throw new Error("recusado: o alvo precisa ser local");
  process.env.NEXT_PUBLIC_SUPABASE_URL = state.supabaseUrl;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = state.anonKey;
  process.env.SUPABASE_SERVICE_ROLE_KEY = state.serviceKey;
}

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": h.ip.value }),
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
// Sessão do membro: o cliente é o supabase-js real com o JWT do papel; só o getUser (GoTrue, ausente no lab) é simulado.
vi.mock("@/lib/supabase/server", async () => {
  const { createClient: create } = await import("@supabase/supabase-js");
  return {
    createClient: async () => {
      const real = create(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        global: { headers: h.session.jwt ? { Authorization: `Bearer ${h.session.jwt}` } : {} },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      return {
        auth: { getUser: async () => ({ data: { user: h.session.userId ? { id: h.session.userId } : null } }) },
        rpc: real.rpc.bind(real),
        from: real.from.bind(real),
        storage: real.storage,
      };
    },
  };
});

describe.skipIf(!enabled)("checkout público com código real contra PostgreSQL + PostgREST locais", () => {
  const SLUG = "loja-a";
  let productId = "";
  let otherStoreProductId = "";
  // cliente sem esquema tipado: o laboratório não gera os tipos do banco
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: SupabaseClient<any, "public", any>;
  const item = () => [{ product_id: productId, quantity: 1, addon_ids: [], observation: "" }];

  async function order(over: Record<string, unknown> = {}) {
    const { submitOrderAction } = await import("@/lib/actions/orders");
    return submitOrderAction({
      slug: SLUG,
      customerName: "Cliente Sintético",
      customerPhone: "11900000001",
      fulfillmentType: "pickup",
      delivery: null,
      paymentMethod: "cash",
      changeFor: null,
      observation: "",
      items: item() as never,
      idempotencyKey: `k-${Math.random().toString(36).slice(2)}`,
      couponCode: null,
      ...over,
    } as never);
  }

  beforeAll(async () => {
    admin = createClient(state.supabaseUrl, state.serviceKey, { auth: { persistSession: false } });
    const { ids } = state;
    const must = (r: { error: { message: string } | null }, what: string) => {
      if (r.error) throw new Error(`seed ${what}: ${r.error.message}`);
    };
    must(await admin.from("profiles").update({ trial_ends_at: new Date(Date.now() + 30 * 864e5).toISOString() }).in("user_id", [ids.ownerA, ids.ownerB]), "trial");
    must(await admin.from("restaurants").update({ onboarding_completed: true, status: "active", service_pickup: true, payment_pix: true, payment_pix_key: "pix@lab.test", payment_pix_key_type: "email" }).in("id", [ids.rA, ids.rB]), "lojas");
    must(await admin.from("business_hours").delete().in("restaurant_id", [ids.rA, ids.rB]), "horarios-del");
    const hours = [ids.rA, ids.rB].flatMap((r) => [0, 1, 2, 3, 4, 5, 6].map((d) => ({ restaurant_id: r, day_of_week: d, opens_at: "00:00", closes_at: "23:59:59", period_order: 1 })));
    must(await admin.from("business_hours").insert(hours), "horarios");
    const catA = await admin.from("categories").insert({ restaurant_id: ids.rA, name: "cat-a", display_order: 1 }).select("id").single();
    const catB = await admin.from("categories").insert({ restaurant_id: ids.rB, name: "cat-b", display_order: 1 }).select("id").single();
    const pA = await admin.from("products").insert({ restaurant_id: ids.rA, name: "prod-a", price: 40, category_id: catA.data!.id, display_order: 1 }).select("id").single();
    const pB = await admin.from("products").insert({ restaurant_id: ids.rB, name: "prod-b", price: 40, category_id: catB.data!.id, display_order: 1 }).select("id").single();
    productId = pA.data!.id as string;
    otherStoreProductId = pB.data!.id as string;
    must(await admin.from("coupons").insert({ restaurant_id: ids.rA, code: "UMUSO", discount_type: "fixed", discount_value: 5, max_uses: 1 }), "cupom");
  }, 60000);

  it("cria o pedido pelo caminho do servidor e repete a mesma chave sem duplicar", async () => {
    h.ip.value = "203.0.113.10";
    const first = await order({ idempotencyKey: "lab-idem-1", customerPhone: "11900000010" });
    const second = await order({ idempotencyKey: "lab-idem-1", customerPhone: "11900000010" });
    expect(first.status).toBe("success");
    expect(second.status).toBe("success");
    if (first.status === "success" && second.status === "success") expect(second.publicId).toBe(first.publicId);
    const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("idempotency_key", "lab-idem-1");
    expect(count).toBe(1);
  });

  it("recusa produto de outra loja e tipo de entrega forjado", async () => {
    h.ip.value = "203.0.113.11";
    const cross = await order({ items: [{ product_id: otherStoreProductId, quantity: 1, addon_ids: [], observation: "" }], customerPhone: "11900000011" });
    expect(cross.status).toBe("error");
    const forged = await order({ fulfillmentType: "counter", customerPhone: "11900000012" });
    expect(forged.status).toBe("error");
  });

  it("cupom de 1 uso: um pedido consome; o segundo é recusado com mensagem amigável", async () => {
    h.ip.value = "203.0.113.12";
    const a = await order({ couponCode: "UMUSO", customerPhone: "11900000013" });
    const b = await order({ couponCode: "UMUSO", customerPhone: "11900000014" });
    expect(a.status).toBe("success");
    expect(b).toEqual({ status: "error", message: expect.stringMatching(/limite de usos/i) });
    const { data } = await admin.from("coupons").select("uses_count").eq("code", "UMUSO").single();
    expect(data?.uses_count).toBe(1);
  });

  it("limite por IP + loja: do 16º pedido em diante o servidor responde 'muitas tentativas' e nada chega ao banco", async () => {
    h.ip.value = "203.0.113.20";
    const results = [];
    for (let i = 0; i < 16; i++) results.push(await order({ customerPhone: `1190000${String(2000 + i)}`, idempotencyKey: `lab-ip-${i}` }));
    expect(results.slice(0, 15).every((r) => r.status === "success")).toBe(true);
    expect(results[15]).toEqual({ status: "error", message: expect.stringMatching(/Muitas tentativas.*minuto/i) });
    const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("idempotency_key", "lab-ip-15");
    expect(count).toBe(0);
    // outro IP não é afetado
    h.ip.value = "203.0.113.21";
    expect((await order({ customerPhone: "11900003000", idempotencyKey: "lab-ip-outro" })).status).toBe("success");
  });

  it("limite por telefone: o 9º pedido do mesmo telefone (formatos diferentes) é barrado, mesmo de IPs diferentes", async () => {
    const formats = ["11 90000-4001", "(11) 90000-4001", "11900004001", "11 90000.4001", "11-90000-4001", "11 9 0000 4001", "(11)900004001", "11 90000 4001", "11.90000.4001"];
    const out = [];
    for (let i = 0; i < formats.length; i++) {
      h.ip.value = `203.0.113.${40 + i}`;
      out.push(await order({ customerPhone: formats[i], idempotencyKey: `lab-fone-${i}` }));
    }
    expect(out.slice(0, 8), JSON.stringify(out)).toSatisfy((a: { status: string }[]) => a.every((r) => r.status === "success"));
    expect(out[8]).toEqual({ status: "error", message: expect.stringMatching(/Muitas tentativas/i) });
  });

  it("limite do cupom: 20 por minuto por IP; depois, mensagem de espera", async () => {
    const { validateCouponAction } = await import("@/lib/actions/couponValidate");
    h.ip.value = "203.0.113.60";
    let last;
    for (let i = 0; i < 21; i++) last = await validateCouponAction(SLUG, "NAOEXISTE", 40);
    expect(last).toEqual({ status: "error", message: expect.stringMatching(/Muitas tentativas/i) });
  });

  it("venda de balcão: STAFF e OWNER entram pela sessão (create_counter_order); membro de OUTRA loja não", async () => {
    const { createCounterOrderAction } = await import("@/lib/actions/counterOrders");
    const input = (key: string) => ({ customerName: "", customerPhone: "", paymentMethod: "cash" as const, changeFor: null, observation: "", items: item() as never, idempotencyKey: key, couponCode: null });

    h.session.jwt = state.staffAJwt;
    h.session.userId = state.ids.staffA;
    // abre o caixa como o próprio STAFF (PostgREST com o JWT do STAFF)
    const asStaff = createClient(state.supabaseUrl, state.anonKey, { global: { headers: { Authorization: `Bearer ${state.staffAJwt}` } }, auth: { persistSession: false } });
    await asStaff.rpc("cash_open", { p_opening_amount: 0 });
    const ok = await createCounterOrderAction(input("lab-bal-staff"));
    expect(ok.status).toBe("success");

    h.session.jwt = state.ownerBJwt;
    h.session.userId = state.ids.ownerB;
    // OWNER da loja B: a ação usa a PRÓPRIA loja dele (getMyRestaurant), nunca a loja A; sem caixa aberto na B, é recusado
    const other = await createCounterOrderAction(input("lab-bal-b"));
    expect(other.status).toBe("error");
    const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("restaurant_id", state.ids.rA).eq("idempotency_key", "lab-bal-b");
    expect(count).toBe(0);
    h.session.jwt = "";
    h.session.userId = "";
  });

  it("a chave pública (anon) não executa as funções revogadas, mas o resto da vitrine funciona", async () => {
    const anon = createClient(state.supabaseUrl, state.anonKey, { auth: { persistSession: false } });
    for (const [fn, args] of [
      ["create_order", { p_slug: SLUG, p_customer_name: "x", p_customer_phone: "11900009999", p_fulfillment_type: "pickup", p_payment_method: "cash", p_items: item(), p_idempotency_key: "lab-direto" }],
      ["validate_coupon", { p_slug: SLUG, p_code: "UMUSO", p_subtotal: 40 }],
      ["preview_promotion", { p_slug: SLUG, p_subtotal: 40 }],
      ["is_document_eligible", { p_document: "52998224725" }],
    ] as const) {
      const r = await anon.rpc(fn, args as never);
      expect(r.error?.message ?? "", fn).toMatch(/permission denied/i);
    }
    const store = await anon.rpc("get_public_restaurant_by_slug", { p_slug: SLUG });
    expect(store.error).toBeNull();
    const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("idempotency_key", "lab-direto");
    expect(count).toBe(0);
  });
});

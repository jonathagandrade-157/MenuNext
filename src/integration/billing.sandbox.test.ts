/**
 * Roteiro para o ASAAS SANDBOX REAL (e, para validar o próprio roteiro, contra o Asaas
 * simulado). Age pela API do Asaas (receber, estornar, cancelar) e ESPERA o efeito
 * aparecer no banco isolado, pelo webhook ou, se ele não chegar, pela reconciliação.
 * Cada passo imprime por qual mecanismo o efeito chegou.
 *
 * Só roda com SANDBOX_E2E=1. Alvo: SANDBOX_TARGET=fake (padrão) ou real.
 *  - real: exige ASAAS_API_KEY de SANDBOX (o teste recusa chave de produção e
 *    ASAAS_ENV=production) e o Next rodando com a mesma chave, o mesmo banco isolado e um
 *    endereço público apontando para o porteiro do webhook (docs/asaas-sandbox-e2e.md).
 *  - SANDBOX_WEBHOOKS=0: não espera webhooks (só reconciliação).
 * Nunca usa o Supabase real nem a produção do Asaas.
 */
import fs from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAsaasCustomer,
  createAsaasSubscription,
  deleteAsaasSubscription,
  getAsaasSubscription,
  listAsaasSubscriptionsByExternalReference,
  resolveAsaasBaseUrl,
} from "../lib/asaas";
import { runSubscribeFlow, type SubscribeDeps } from "../lib/subscribeFlow";
import { FakeAsaas, isoDate } from "./fakeAsaas";

const enabled = process.env.SANDBOX_E2E === "1";
const target = process.env.SANDBOX_TARGET ?? "fake";
const waitForWebhooks = process.env.SANDBOX_WEBHOOKS !== "0";
const NEXT = process.env.BILLING_NEXT_URL ?? "http://127.0.0.1:3000";
const FAKE_PORT = 54340;
const FAKE_KEY = "fake-asaas-key-for-local-rehearsal-only";

type LabState = {
  supabaseUrl: string;
  anonKey: string;
  serviceKey: string;
  ownerAJwt: string;
  ownerBJwt: string;
  ids: { rA: string; rB: string };
  planId: string;
  webhookToken: string;
  cronSecret: string;
};

describe.skipIf(!enabled)(`cobrança no Asaas ${target === "real" ? "SANDBOX REAL" : "simulado"} (efeitos observados no banco isolado)`, { timeout: 180_000 }, () => {
  let S: LabState;
  let fake: FakeAsaas | null = null;
  let userA: SupabaseClient;
  let userB: SupabaseClient;
  let svc: SupabaseClient;
  const createdRemote: string[] = [];
  const mechanism: string[] = [];

  const client = (jwt: string) =>
    createClient(S.supabaseUrl, S.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${jwt}` } } });

  async function asaas(method: string, path: string, body?: unknown) {
    const response = await fetch(`${resolveAsaasBaseUrl({ ASAAS_ENV: process.env.ASAAS_ENV, ASAAS_BASE_URL: process.env.ASAAS_BASE_URL })}${path}`, {
      method,
      headers: { "Content-Type": "application/json", access_token: process.env.ASAAS_API_KEY! },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: response.status, ok: response.ok, json };
  }

  const access = async (user: SupabaseClient) => ((await user.rpc("get_my_access_state")).data ?? null) as string | null;
  const subs = async (rid: string) => (await svc.from("billing_subscriptions").select("*").eq("restaurant_id", rid).order("created_at", { ascending: false })).data ?? [];
  const payments = async (subId: string) => (await svc.from("billing_payments").select("*").eq("subscription_id", subId).order("created_at")).data ?? [];
  const cron = () => fetch(`${NEXT}/api/cron/billing-reconcile`, { headers: { authorization: `Bearer ${S.cronSecret}` } }).then((r) => r.status);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** Espera o efeito pelo webhook; se não vier no prazo, tenta a reconciliação. Registra o mecanismo. */
  async function settle(label: string, predicate: () => Promise<boolean>, webhookSeconds = 45) {
    if (waitForWebhooks) {
      for (let i = 0; i < webhookSeconds; i++) {
        if (await predicate()) {
          mechanism.push(`${label}: webhook`);
          return;
        }
        await sleep(1000);
      }
    }
    expect(await cron(), "rota de reconciliação").toBe(200);
    if (await predicate()) {
      mechanism.push(`${label}: reconciliação (webhook NÃO chegou)`);
      return;
    }
    throw new Error(`${label}: efeito não apareceu nem por webhook nem pela reconciliação`);
  }

  const deps = (user: SupabaseClient, who: { name: string; document: string; email: string }): SubscribeDeps => ({
    beginSubscription: (planId) => user.rpc("billing_begin_subscription", { p_plan_id: planId }),
    getBillingProfile: async () => who,
    attachSubscription: (a) =>
      svc.rpc("billing_attach_provider_subscription", {
        p_subscription_id: a.subscriptionId,
        p_provider_customer_id: a.customerId,
        p_provider_subscription_id: a.providerSubscriptionId,
        p_verified_amount: a.verifiedAmount,
      }),
    asaas: {
      listByExternalReference: listAsaasSubscriptionsByExternalReference,
      createCustomer: createAsaasCustomer,
      createSubscription: createAsaasSubscription,
      deleteSubscription: deleteAsaasSubscription,
      getSubscription: getAsaasSubscription,
    },
  });
  const ownerA = { name: "Dono A", document: "52998224725", email: "dono-a@lab.test" };
  const ownerB = { name: "Dono B", document: "39053344705", email: "dono-b@lab.test" };

  beforeAll(async () => {
    S = JSON.parse(fs.readFileSync(process.env.BILLING_LAB_STATE!, "utf8")) as LabState;
    if (target === "real") {
      // Trava de segurança: só sandbox, nunca produção.
      expect(process.env.ASAAS_ENV, "ASAAS_ENV").not.toBe("production");
      expect(process.env.ASAAS_API_KEY ?? "", "ASAAS_API_KEY").not.toMatch(/^\$aact_prod_/i);
      expect(process.env.ASAAS_API_KEY ?? "").not.toBe("");
      process.env.ASAAS_ENV = "sandbox";
      delete process.env.ASAAS_BASE_URL;
    } else {
      process.env.ASAAS_API_KEY = FAKE_KEY;
      process.env.ASAAS_ENV = "sandbox";
      process.env.ASAAS_BASE_URL = `http://127.0.0.1:${FAKE_PORT}/v3`;
      fake = new FakeAsaas(FAKE_KEY, `${NEXT}/api/webhooks/asaas`, S.webhookToken);
      fake.autoWebhook = true;
      await fake.start(FAKE_PORT);
    }
    userA = client(S.ownerAJwt);
    userB = client(S.ownerBJwt);
    svc = client(S.serviceKey);
  });

  afterAll(async () => {
    // limpeza: remove no Asaas as assinaturas criadas por este roteiro
    if (target === "real") for (const id of createdRemote) await asaas("DELETE", `/subscriptions/${id}`).catch(() => undefined);
    await fake?.stop();
    console.log("\nMecanismo que entregou cada efeito:\n  " + mechanism.join("\n  "));
  });

  let aSub = "";
  let aRemote = "";
  let aPay = "";
  let bRemote = "";

  it("1. assinatura legítima criada no Asaas com a referência do MenuNext, provada e registrada; acesso continua bloqueado", async () => {
    expect(await access(userA)).toBe("trial_expired");
    expect(await runSubscribeFlow(S.planId, deps(userA, ownerA))).toEqual({ status: "success" });
    const [sub] = await subs(S.ids.rA);
    aSub = sub.id;
    aRemote = sub.provider_subscription_id as string;
    createdRemote.push(aRemote);
    expect(sub.status).toBe("pending");
    const remote = await asaas("GET", `/subscriptions/${aRemote}`);
    expect(remote.json).toMatchObject({ id: aRemote, externalReference: aSub, status: "ACTIVE" });
    expect(Number(remote.json?.value)).toBe(5);
    expect(await access(userA)).toBe("trial_expired");
  });

  it("2. a primeira cobrança aparece pendente (webhook PAYMENT_CREATED) e não libera nada", async () => {
    const list = await asaas("GET", `/subscriptions/${aRemote}/payments?offset=0&limit=10`);
    expect(list.ok).toBe(true);
    const first = (list.json?.data as { id: string; status: string }[])[0];
    expect(first).toBeTruthy();
    aPay = first.id;
    if (waitForWebhooks) await settle("PAYMENT_CREATED", async () => (await payments(aSub)).some((p) => p.provider_payment_id === aPay));
    expect(await access(userA)).toBe("trial_expired");
  });

  it("3. evento FORJADO (token certo, cobrança ainda pendente na API do Asaas) não libera", async () => {
    const forged = await fetch(`${NEXT}/api/webhooks/asaas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "asaas-access-token": S.webhookToken },
      body: JSON.stringify({
        id: "evt_forjado_" + Date.now(),
        event: "PAYMENT_CONFIRMED",
        dateCreated: "2026-10-09 12:00:00",
        payment: { id: aPay, customer: "cus_x", subscription: aRemote, value: 5, dueDate: isoDate(1) },
      }),
    });
    const body = (await forged.json()) as { result?: string };
    expect(forged.status).toBe(200);
    expect(body.result).toBe("unverified");
    expect(await access(userA)).toBe("trial_expired");
  });

  it("4. pagamento recebido no Asaas libera o acesso (PAYMENT_RECEIVED)", async () => {
    const received = await asaas("POST", `/payments/${aPay}/receiveInCash`, { paymentDate: isoDate(), value: 5, notifyCustomer: false });
    expect(received.ok, JSON.stringify(received.json)).toBe(true);
    await settle("PAYMENT_RECEIVED", async () => (await access(userA)) === null);
    const [sub] = await subs(S.ids.rA);
    expect(sub.status).toBe("active");
    expect(new Date(sub.current_period_end as string).getTime()).toBeGreaterThan(Date.now());
  });

  it("5. reentrega do mesmo evento (mesmo id) vira duplicate, sem novo período", async () => {
    const { data } = await svc.from("asaas_webhook_events").select("asaas_event_id").eq("provider", "asaas").eq("event_type", "PAYMENT_RECEIVED").limit(1);
    const eventId = data?.[0]?.asaas_event_id as string | undefined;
    if (!eventId) {
      mechanism.push("duplicidade: sem evento de webhook guardado (webhook não chegou); coberto no ensaio local");
      return;
    }
    const before = (await subs(S.ids.rA))[0].current_period_end;
    const replay = await fetch(`${NEXT}/api/webhooks/asaas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "asaas-access-token": S.webhookToken },
      body: JSON.stringify({ id: eventId, event: "PAYMENT_RECEIVED", dateCreated: "2026-10-09 12:00:00", payment: { id: aPay, customer: (await subs(S.ids.rA))[0].provider_customer_id, subscription: aRemote, value: 5, dueDate: isoDate(1) } }),
    });
    expect(((await replay.json()) as { result?: string }).result).toBe("duplicate");
    expect((await subs(S.ids.rA))[0].current_period_end).toBe(before);
  });

  it("6. webhook PERDIDO: com o estado local desfeito, a reconciliação recupera pela API do Asaas", async () => {
    await svc.from("billing_payments").update({ status: "pending" }).eq("subscription_id", aSub);
    await svc.from("billing_subscriptions").update({ status: "pending", current_period_end: null }).eq("id", aSub);
    expect(await access(userA)).toBe("trial_expired");
    expect(await cron()).toBe(200);
    expect(await access(userA)).toBeNull();
    expect((await subs(S.ids.rA))[0].status).toBe("active");
    mechanism.push("recuperação de webhook perdido: reconciliação");
  });

  it("7. cancelamento no Asaas preserva o período já pago; vencido o período, bloqueia", async () => {
    const del = await asaas("DELETE", `/subscriptions/${aRemote}`);
    expect(del.ok, JSON.stringify(del.json)).toBe(true);
    await settle("SUBSCRIPTION_DELETED", async () => (await subs(S.ids.rA))[0].status === "cancelled");
    expect(await access(userA)).toBeNull();
    await svc.from("billing_subscriptions").update({ current_period_end: new Date(Date.now() - 86_400_000).toISOString() }).eq("id", aSub);
    expect(await access(userA)).toBe("cancelled");
  });

  it("8. estorno no Asaas (loja B): remove o período pago e bloqueia", async () => {
    expect(await runSubscribeFlow(S.planId, deps(userB, ownerB))).toEqual({ status: "success" });
    const [bSub] = await subs(S.ids.rB);
    bRemote = bSub.provider_subscription_id as string;
    createdRemote.push(bRemote);
    const list = await asaas("GET", `/subscriptions/${bRemote}/payments?offset=0&limit=10`);
    const bPay = (list.json?.data as { id: string }[])[0].id;

    expect((await asaas("POST", `/payments/${bPay}/receiveInCash`, { paymentDate: isoDate(), value: 5, notifyCustomer: false })).ok).toBe(true);
    await settle("B PAYMENT_RECEIVED", async () => (await access(userB)) === null);

    const refund = await asaas("POST", `/payments/${bPay}/refund`, {});
    // Em cobrança recebida em dinheiro o Asaas pode recusar o estorno; nesse caso a falha é do recurso, não do MenuNext.
    if (!refund.ok) {
      mechanism.push(`estorno: o Asaas recusou (${refund.status}); coberto no ensaio local`);
      return;
    }
    await settle("PAYMENT_REFUNDED", async () => (await access(userB)) === "trial_expired");
  });

  it("9. a loja A (nova tentativa) não consegue vincular a assinatura real da loja B (nem como lojista, nem por id repetido)", async () => {
    // A está cancelada (sem assinatura viva), então pode abrir uma nova tentativa.
    const begun = await userA.rpc("billing_begin_subscription", { p_plan_id: S.planId });
    expect(begun.error).toBeNull();
    const initiated = ((begun.data as { out_subscription_id: string }[] | null) ?? [])[0].out_subscription_id;
    const [b] = await subs(S.ids.rB);
    const asOwner = await userA.rpc("billing_attach_provider_subscription", {
      p_subscription_id: initiated, p_provider_customer_id: b.provider_customer_id, p_provider_subscription_id: bRemote, p_verified_amount: 5,
    });
    expect(asOwner.error?.message ?? "").toMatch(/permission denied/i);
    const byBackend = await svc.rpc("billing_attach_provider_subscription", {
      p_subscription_id: initiated, p_provider_customer_id: b.provider_customer_id, p_provider_subscription_id: bRemote, p_verified_amount: 5,
    });
    expect(byBackend.error?.message ?? "").toMatch(/provider_reference_in_use/);
    expect((await subs(S.ids.rA))[0].status).toBe("initiated");
    expect(await access(userA)).toBe("cancelled");
  });
});

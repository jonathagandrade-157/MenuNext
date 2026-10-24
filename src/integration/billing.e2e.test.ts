/**
 * Ensaio ponta a ponta da cobrança: backend Next.js REAL (next start) + banco
 * PostgreSQL/PostgREST ISOLADO + Asaas SIMULADO local (src/integration/fakeAsaas.ts).
 *
 * NÃO roda na suíte normal: só com BILLING_E2E=1 (veja docs/asaas-sandbox-e2e.md).
 * Variáveis: BILLING_LAB_STATE (json do laboratório), BILLING_NEXT_URL (padrão
 * http://127.0.0.1:3000), FAKE_ASAAS_KEY. O servidor Next precisa estar rodando
 * com ASAAS_BASE_URL apontando para o Asaas simulado (porta 54340) e a mesma chave.
 * Nunca usa Supabase real nem Asaas real.
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
} from "../lib/asaas";
import { runSubscribeFlow, type SubscribeDeps } from "../lib/subscribeFlow";
import { FakeAsaas, isoDate } from "./fakeAsaas";

const enabled = process.env.BILLING_E2E === "1";
const FAKE_PORT = 54340;
const NEXT = process.env.BILLING_NEXT_URL ?? "http://127.0.0.1:3000";
const KEY = process.env.FAKE_ASAAS_KEY ?? "fake-asaas-key-for-local-rehearsal-only";

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

describe.skipIf(!enabled)("cobrança ponta a ponta (Next real + banco isolado + Asaas simulado)", { timeout: 60_000 }, () => {
  let S: LabState;
  let fake: FakeAsaas;
  let userA: SupabaseClient;
  let userB: SupabaseClient;
  let svc: SupabaseClient;

  const client = (key: string) =>
    createClient(S.supabaseUrl, S.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${key}` } } });

  const access = async (user: SupabaseClient) => {
    const { data, error } = await user.rpc("get_my_access_state");
    expect(error).toBeNull();
    return (data ?? null) as string | null;
  };
  const subs = async (rid: string) => {
    const { data, error } = await svc.from("billing_subscriptions").select("*").eq("restaurant_id", rid).order("created_at", { ascending: false });
    expect(error).toBeNull();
    return data ?? [];
  };
  const payments = async (subId: string) => {
    const { data } = await svc.from("billing_payments").select("*").eq("subscription_id", subId).order("created_at");
    return data ?? [];
  };
  const cron = async (auth?: string) => {
    const r = await fetch(`${NEXT}/api/cron/billing-reconcile`, { headers: auth ? { authorization: auth } : {} });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };

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
    process.env.ASAAS_API_KEY = KEY;
    process.env.ASAAS_ENV = "sandbox";
    process.env.ASAAS_BASE_URL = `http://127.0.0.1:${FAKE_PORT}/v3`;
    fake = new FakeAsaas(KEY, `${NEXT}/api/webhooks/asaas`, S.webhookToken);
    await fake.start(FAKE_PORT);
    userA = client(S.ownerAJwt);
    userB = client(S.ownerBJwt);
    svc = client(S.serviceKey);
  });
  afterAll(async () => {
    await fake?.stop();
  });

  // ------------------------------------------------------------------ A: assinatura legítima
  let aSubId = "";
  let a1 = "";
  it("1. assinatura legítima: abre no banco, cria no Asaas com a referência do MenuNext, prova a origem e registra; acesso segue bloqueado", async () => {
    expect(await access(userA)).toBe("trial_expired");
    const result = await runSubscribeFlow(S.planId, deps(userA, ownerA));
    expect(result).toEqual({ status: "success" });

    const [sub] = await subs(S.ids.rA);
    aSubId = sub.id;
    expect(sub.status).toBe("pending");
    expect(Number(sub.amount)).toBe(5);
    expect(fake.subscriptions.size).toBe(1);
    const remote = [...fake.subscriptions.values()][0];
    expect(remote.externalReference).toBe(sub.id);
    expect(sub.provider_subscription_id).toBe(remote.id);
    a1 = fake.firstPayment(remote.id).id;
    expect(await access(userA)).toBe("trial_expired"); // pending não libera
  });

  it("2. assinar de novo não duplica nada (já existe assinatura viva)", async () => {
    const before = fake.subscriptions.size;
    const result = await runSubscribeFlow(S.planId, deps(userA, ownerA));
    expect(result.status).toBe("error");
    expect(fake.subscriptions.size).toBe(before);
  });

  // ------------------------------------------------------------------ IDs inventados / outra conta
  it("3. o lojista não registra ids (nem reais, nem inventados) e o backend recusa valor errado ou id mal formado", async () => {
    const begun = await userB.rpc("billing_begin_subscription", { p_plan_id: S.planId });
    expect(begun.error).toBeNull();
    const bInitiated = (begun.data as { out_subscription_id: string }[])[0].out_subscription_id;

    const asOwner = await userB.rpc("billing_attach_provider_subscription", {
      p_subscription_id: bInitiated,
      p_provider_customer_id: "cus_INVENTADO001",
      p_provider_subscription_id: "sub_INVENTADO001",
      p_verified_amount: 5,
    });
    expect(asOwner.error?.message ?? "").toMatch(/permission denied/i);
    const ownerOfOther = await userA.rpc("billing_attach_provider_subscription", {
      p_subscription_id: bInitiated,
      p_provider_customer_id: "cus_INVENTADO001",
      p_provider_subscription_id: "sub_INVENTADO001",
      p_verified_amount: 5,
    });
    expect(ownerOfOther.error?.message ?? "").toMatch(/permission denied/i);

    const wrongAmount = await svc.rpc("billing_attach_provider_subscription", {
      p_subscription_id: bInitiated,
      p_provider_customer_id: "cus_INVENTADO001",
      p_provider_subscription_id: "sub_INVENTADO001",
      p_verified_amount: 1,
    });
    expect(wrongAmount.error?.message ?? "").toMatch(/amount_mismatch/);
    const badFormat = await svc.rpc("billing_attach_provider_subscription", {
      p_subscription_id: bInitiated,
      p_provider_customer_id: "x",
      p_provider_subscription_id: "y",
      p_verified_amount: 5,
    });
    expect(badFormat.error?.message ?? "").toMatch(/invalid_provider_reference/);
    const [b] = await subs(S.ids.rB);
    expect(b.status).toBe("initiated");
    expect(await access(userB)).toBe("trial_expired");
  });

  it("4. a leitura de volta divergente (outro valor, outro cliente, outra referência) NÃO registra e desfaz a assinatura criada", async () => {
    for (const tamper of [{ value: 99 }, { customer: "cus_de_outra_conta" }, { externalReference: "outra-tentativa" }, { status: "INACTIVE" as const }]) {
      fake.tamper = tamper;
      const result = await runSubscribeFlow(S.planId, deps(userB, ownerB));
      expect(result.status).toBe("error");
      const [b] = await subs(S.ids.rB);
      expect(b.status).toBe("initiated");
      expect(b.provider_subscription_id).toBeNull();
    }
    fake.tamper = null;
    const created = [...fake.subscriptions.values()].filter((s) => s.customer && s.externalReference);
    expect(created.length).toBeGreaterThanOrEqual(5);
    expect(created.slice(1).every((s) => s.deleted)).toBe(true); // tudo que falhou foi removido do Asaas
  });

  it("5. assinatura de OUTRA tentativa no Asaas não é reaproveitada", async () => {
    const stranger = fake.subscriptions.get([...fake.subscriptions.keys()][0])!; // a do restaurante A
    expect(stranger.externalReference).toBe(aSubId);
    const result = await runSubscribeFlow(S.planId, deps(userB, ownerB));
    expect(result).toEqual({ status: "success" });
    const [b] = await subs(S.ids.rB);
    expect(b.provider_subscription_id).not.toBe(stranger.id);
    expect(b.status).toBe("pending");
  });

  // ------------------------------------------------------------------ webhooks
  it("6. webhook: sem token e com token errado são recusados; token certo registra a cobrança pendente", async () => {
    const p = fake.payments.get(a1)!;
    expect((await fake.sendPaymentEvent("PAYMENT_CREATED", p, { token: null })).status).toBe(401);
    expect((await fake.sendPaymentEvent("PAYMENT_CREATED", p, { token: "token-errado" })).status).toBe(401);
    expect((await payments(aSubId)).length).toBe(0);

    const ok = await fake.sendPaymentEvent("PAYMENT_CREATED", p);
    expect(ok).toMatchObject({ status: 200, body: { result: "applied" } });
    const rows = await payments(aSubId);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("pending");
    expect(await access(userA)).toBe("trial_expired");
  });

  it("7. confirmação FORJADA (token certo, mas a cobrança segue pendente no Asaas) não libera nada", async () => {
    const p = fake.payments.get(a1)!;
    const res = await fake.sendPaymentEvent("PAYMENT_CONFIRMED", p);
    expect(res).toMatchObject({ status: 200, body: { result: "unverified", reason: "payment_not_paid" } });
    expect(await access(userA)).toBe("trial_expired");
    expect((await subs(S.ids.rA))[0].status).toBe("pending");
  });

  it("8. pagamento de VALOR INCORRETO (a API do Asaas diz pago, mas com valor menor) não libera", async () => {
    fake.setPayment(a1, { status: "CONFIRMED", value: 1, paymentDate: isoDate() });
    const res = await fake.sendPaymentEvent("PAYMENT_CONFIRMED", fake.payments.get(a1)!);
    expect(res).toMatchObject({ status: 200, body: { result: "value_mismatch" } });
    expect(await access(userA)).toBe("trial_expired");
    fake.setPayment(a1, { status: "PENDING", value: 5, paymentDate: null });
  });

  it("9. pagamento confirmado libera; evento duplicado vira duplicate; RECEIVED da mesma cobrança vira noop (um período só)", async () => {
    fake.setPayment(a1, { status: "CONFIRMED", paymentDate: isoDate() });
    const eventId = fake.nextEventId();
    const first = await fake.sendPaymentEvent("PAYMENT_CONFIRMED", fake.payments.get(a1)!, { eventId });
    expect(first).toMatchObject({ status: 200, body: { result: "applied" } });
    expect(await access(userA)).toBeNull();

    const [sub] = await subs(S.ids.rA);
    expect(sub.status).toBe("active");
    const periodEnd = new Date(sub.current_period_end as string).getTime();
    expect(periodEnd).toBeGreaterThan(Date.now());

    expect(await fake.sendPaymentEvent("PAYMENT_CONFIRMED", fake.payments.get(a1)!, { eventId })).toMatchObject({ body: { result: "duplicate" } });
    fake.setPayment(a1, { status: "RECEIVED" });
    expect(await fake.sendPaymentEvent("PAYMENT_RECEIVED", fake.payments.get(a1)!)).toMatchObject({ body: { result: "noop" } });
    const rows = await payments(aSubId);
    expect(rows.length).toBe(1);
    expect(new Date((await subs(S.ids.rA))[0].current_period_end as string).getTime()).toBe(periodEnd);
  });

  it("10. evento FORA DE ORDEM (OVERDUE depois do pagamento) é ignorado", async () => {
    const res = await fake.sendPaymentEvent("PAYMENT_OVERDUE", fake.payments.get(a1)!);
    expect(res).toMatchObject({ status: 200, body: { result: "stale" } });
    expect(await access(userA)).toBeNull();
  });

  it("11. renovação: cobrança nova, atraso bloqueia, pagamento libera de novo", async () => {
    const remote = fake.subscriptions.get([...fake.subscriptions.values()].find((s) => s.externalReference === aSubId)!.id)!;
    const a2 = fake.newPayment(remote, isoDate(31));
    expect(await fake.sendPaymentEvent("PAYMENT_CREATED", a2)).toMatchObject({ body: { result: "applied" } });
    expect(await access(userA)).toBeNull();

    fake.setPayment(a2.id, { status: "OVERDUE" });
    expect(await fake.sendPaymentEvent("PAYMENT_OVERDUE", fake.payments.get(a2.id)!)).toMatchObject({ body: { result: "applied" } });
    expect(await access(userA)).toBe("overdue");

    fake.setPayment(a2.id, { status: "CONFIRMED", paymentDate: isoDate() });
    expect(await fake.sendPaymentEvent("PAYMENT_CONFIRMED", fake.payments.get(a2.id)!)).toMatchObject({ body: { result: "applied" } });
    expect(await access(userA)).toBeNull();
  });

  it("12. estorno: cada cobrança estornada tira o período correspondente; sem nada pago, bloqueia", async () => {
    const a2 = [...fake.payments.values()].find((p) => p.subscription && p.id !== a1 && p.dueDate === isoDate(31))!;
    fake.setPayment(a2.id, { status: "REFUNDED" });
    expect(await fake.sendPaymentEvent("PAYMENT_REFUNDED", fake.payments.get(a2.id)!)).toMatchObject({ body: { result: "applied" } });
    expect(await access(userA)).toBeNull(); // a 1a cobranca ainda cobre o periodo atual

    fake.setPayment(a1, { status: "REFUNDED" });
    expect(await fake.sendPaymentEvent("PAYMENT_REFUNDED", fake.payments.get(a1)!)).toMatchObject({ body: { result: "applied" } });
    expect(await access(userA)).toBe("trial_expired");
    const [sub] = await subs(S.ids.rA);
    expect(sub.status).toBe("pending");
    expect(sub.current_period_end).toBeNull();
  });

  // ------------------------------------------------------------------ reconciliação (webhook não recebido)
  it("13. webhook de pagamento NÃO recebido: a reconciliação recupera e libera", async () => {
    const [bSub] = await subs(S.ids.rB);
    const b1 = fake.firstPayment(bSub.provider_subscription_id as string);
    fake.setPayment(b1.id, { status: "RECEIVED", paymentDate: isoDate() }); // pago no Asaas, sem enviar evento
    expect(await access(userB)).toBe("trial_expired");

    expect((await cron()).status).toBe(401);
    expect((await cron("Bearer errado")).status).toBe(401);
    const run = await cron(`Bearer ${S.cronSecret}`);
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({ ok: true, errors: 0, unavailable: 0 });
    expect(Number(run.body.applied)).toBeGreaterThanOrEqual(1);
    expect(await access(userB)).toBeNull();
    expect((await subs(S.ids.rB))[0].status).toBe("active");
  });

  it("14. estorno NÃO notificado: a reconciliação corrige e volta a bloquear; confirmação posterior também é recuperada", async () => {
    const [bSub] = await subs(S.ids.rB);
    const b1 = fake.firstPayment(bSub.provider_subscription_id as string);
    fake.setPayment(b1.id, { status: "REFUNDED" });
    await cron(`Bearer ${S.cronSecret}`);
    expect(await access(userB)).toBe("trial_expired");

    fake.setPayment(b1.id, { status: "CONFIRMED" });
    await cron(`Bearer ${S.cronSecret}`);
    expect(await access(userB)).toBeNull();
  });

  // ------------------------------------------------------------------ cancelamento e período pago
  it("15. cancelamento preserva o período já pago; vencido o período, bloqueia", async () => {
    const [bSub] = await subs(S.ids.rB);
    const remote = fake.subscriptions.get(bSub.provider_subscription_id as string)!;
    remote.deleted = true;
    remote.status = "INACTIVE";
    expect(await fake.sendSubscriptionEvent("SUBSCRIPTION_DELETED", remote)).toMatchObject({ status: 200, body: { result: "cancelled" } });
    expect((await subs(S.ids.rB))[0].status).toBe("cancelled");
    expect(await access(userB)).toBeNull(); // periodo pago ainda vigora

    const past = new Date(Date.now() - 86_400_000).toISOString();
    const upd = await svc.from("billing_subscriptions").update({ current_period_end: past }).eq("id", bSub.id);
    expect(upd.error).toBeNull();
    expect(await access(userB)).toBe("cancelled");
  });

  it("16. cancelamento NÃO notificado numa nova assinatura é recuperado pela reconciliação, também preservando o período pago", async () => {
    expect(await runSubscribeFlow(S.planId, deps(userB, ownerB))).toEqual({ status: "success" });
    const [bNew] = await subs(S.ids.rB);
    expect(bNew.status).toBe("pending");
    const remote = fake.subscriptions.get(bNew.provider_subscription_id as string)!;
    const pay = fake.firstPayment(remote.id);
    fake.setPayment(pay.id, { status: "RECEIVED", paymentDate: isoDate() });
    await cron(`Bearer ${S.cronSecret}`);
    expect(await access(userB)).toBeNull();

    remote.deleted = true;
    remote.status = "INACTIVE";
    await cron(`Bearer ${S.cronSecret}`);
    expect((await subs(S.ids.rB))[0].status).toBe("cancelled");
    expect(await access(userB)).toBeNull();
  });

  // ------------------------------------------------------------------ Asaas indisponível
  it("17. Asaas fora do ar durante uma confirmação: 503 (para o Asaas reenviar) e nada é liberado", async () => {
    const [aSub] = await subs(S.ids.rA);
    const remote = fake.subscriptions.get(aSub.provider_subscription_id as string)!;
    const a3 = fake.newPayment(remote, isoDate(2));
    fake.setPayment(a3.id, { status: "CONFIRMED", paymentDate: isoDate() });
    fake.down = true;
    const res = await fake.sendPaymentEvent("PAYMENT_CONFIRMED", fake.payments.get(a3.id)!);
    expect(res.status).toBe(503);
    expect(await access(userA)).toBe("trial_expired");
    const cronRes = await cron(`Bearer ${S.cronSecret}`);
    expect(cronRes.status).toBe(200);
    expect(Number(cronRes.body.unavailable)).toBeGreaterThanOrEqual(1);
    fake.down = false;

    const retry = await fake.sendPaymentEvent("PAYMENT_CONFIRMED", fake.payments.get(a3.id)!);
    expect(retry).toMatchObject({ status: 200, body: { result: "applied" } });
    expect(await access(userA)).toBeNull();
  });
});

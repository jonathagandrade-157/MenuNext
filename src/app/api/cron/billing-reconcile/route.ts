/**
 * Reconciliação periódica das assinaturas com a API do Asaas (agendada pelo
 * Vercel Cron em vercel.json). Recupera pagamentos e cancelamentos cujo webhook
 * não chegou e corrige o que um evento forjado ou atrasado tenha deixado
 * errado. Lógica em src/lib/billingReconcile.ts.
 *
 * Proteção: exige `Authorization: Bearer <CRON_SECRET>` (o Vercel Cron envia
 * isso quando a variável CRON_SECRET existe no projeto). Sem o segredo
 * configurado, ou com segredo curto demais, a rota falha FECHADO. Também exige
 * a chave do Asaas e a chave de servidor do Supabase; nunca expõe dados no
 * retorno (só contagens).
 */
import { NextResponse } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { getAsaasSubscription, isAsaasConfigured, listAsaasSubscriptionPayments } from "@/lib/asaas";
import { reconcileBatch, type ReconcilableRow } from "@/lib/billingReconcile";
import { safeEqual } from "@/lib/safeEqual";

export const maxDuration = 60;

const BATCH_SIZE = 40;
const TIME_BUDGET_MS = 50_000;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!safeEqual(request.headers.get("authorization"), `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isAsaasConfigured() || !isAdminConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const admin = createAdminClient();
  const list = await admin.rpc("billing_list_reconcilable", { p_limit: BATCH_SIZE });
  if (list.error) {
    return NextResponse.json({ error: "list_failed" }, { status: 500 });
  }

  const summary = await reconcileBatch(
    (list.data ?? []) as ReconcilableRow[],
    {
      getSubscription: getAsaasSubscription,
      listPayments: listAsaasSubscriptionPayments,
      rpc: (fn, args) => admin.rpc(fn, args),
    },
    { deadlineMs: Date.now() + TIME_BUDGET_MS }
  );

  return NextResponse.json({ ok: true, ...summary });
}

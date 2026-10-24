/**
 * Reconciliação periódica das assinaturas com a API do provedor (Asaas e/ou
 * Mercado Pago; agendada pelo Vercel Cron em vercel.json). Recupera pagamentos
 * e cancelamentos cujo webhook não chegou e corrige o que um evento forjado ou
 * atrasado tenha deixado errado. Lógica em src/lib/billingReconcile.ts (Asaas)
 * e src/lib/mercadopagoReconcile.ts (Mercado Pago).
 *
 * Só reconcilia os provedores CONFIGURADOS (a lista já vem filtrada pelo banco,
 * para as assinaturas de um provedor sem credenciais não ocuparem o lote).
 *
 * Proteção: exige `Authorization: Bearer <CRON_SECRET>` (o Vercel Cron envia
 * isso quando a variável CRON_SECRET existe no projeto). Sem o segredo
 * configurado, ou com segredo curto demais, a rota falha FECHADO. Também exige
 * a chave de servidor do Supabase e a de pelo menos um provedor; nunca expõe
 * dados no retorno (só contagens).
 */
import { NextResponse } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { getAsaasSubscription, isAsaasConfigured, listAsaasSubscriptionPayments } from "@/lib/asaas";
import { reconcileBatch, type ReconcilableRow, type ReconcileSummary } from "@/lib/billingReconcile";
import { isMercadoPagoConfigured, getMercadoPagoPreapproval, listMercadoPagoAuthorizedPayments } from "@/lib/mercadopago";
import { reconcileMercadoPagoBatch } from "@/lib/mercadopagoReconcile";
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
  const providers: string[] = [];
  if (isAsaasConfigured()) providers.push("asaas");
  if (isMercadoPagoConfigured()) providers.push("mercadopago");
  if (providers.length === 0 || !isAdminConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const admin = createAdminClient();
  const list = await admin.rpc("billing_list_reconcilable", { p_limit: BATCH_SIZE, p_providers: providers });
  if (list.error) {
    return NextResponse.json({ error: "list_failed" }, { status: 500 });
  }

  const rows = (list.data ?? []) as ReconcilableRow[];
  const rpc = (fn: string, args: Record<string, unknown>) => admin.rpc(fn, args);
  const options = { deadlineMs: Date.now() + TIME_BUDGET_MS };

  const asaas = await reconcileBatch(
    rows.filter((row) => row.out_provider === "asaas"),
    { getSubscription: getAsaasSubscription, listPayments: listAsaasSubscriptionPayments, rpc },
    options
  );
  const mercadopago = await reconcileMercadoPagoBatch(
    rows.filter((row) => row.out_provider === "mercadopago"),
    { getPreapproval: getMercadoPagoPreapproval, listAuthorizedPayments: listMercadoPagoAuthorizedPayments, rpc },
    options
  );

  const summary: ReconcileSummary = {
    checked: asaas.checked + mercadopago.checked,
    applied: asaas.applied + mercadopago.applied,
    unavailable: asaas.unavailable + mercadopago.unavailable,
    notFound: asaas.notFound + mercadopago.notFound,
    errors: asaas.errors + mercadopago.errors,
  };
  return NextResponse.json({ ok: true, ...summary });
}

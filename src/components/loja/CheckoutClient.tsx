"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useBag } from "@/contexts/BagContext";
import { submitOrderAction } from "@/lib/actions/orders";
import { getDeliveryQuoteAction } from "@/lib/actions/delivery-quote";
import {
  PAYMENT_METHOD_LABELS,
  buildOrderItemsPayload,
  generateIdempotencyKey,
  validateChangeFor,
  validateCheckoutObservation,
  validateCustomerName,
  validateCustomerPhone,
  validateDeliveryAddress,
  validateMinimumOrder,
  type PaymentMethod,
} from "@/lib/checkout";
import { parseMoneyInput } from "@/lib/products";
import { formatCurrencyBRL } from "@/lib/store";

function idempotencyStorageKey(slug: string): string {
  return `menunext-checkout-idem-${slug}`;
}

/** Lê a chave de idempotência da sessão (sobrevive a reload da página
 * durante o mesmo checkout) ou gera uma nova. Nunca regenerada só porque o
 * componente remontou — só quando o pedido anterior foi concluído (ver
 * limpeza no sucesso, abaixo). */
function readOrCreateIdempotencyKey(slug: string): string {
  try {
    const existing = window.sessionStorage.getItem(idempotencyStorageKey(slug));
    if (existing) return existing;
    const created = generateIdempotencyKey();
    window.sessionStorage.setItem(idempotencyStorageKey(slug), created);
    return created;
  } catch {
    return generateIdempotencyKey();
  }
}

export function CheckoutClient({
  slug,
  deliveryFee,
  deliveryFeeMethod,
  deliveryRadiusKm,
  minimumOrderValue,
  paymentPix,
  paymentCash,
  paymentCard,
}: {
  slug: string;
  deliveryFee: number | null;
  deliveryFeeMethod: "fixed" | "per_km";
  deliveryRadiusKm: number | null;
  minimumOrderValue: number | null;
  paymentPix: boolean;
  paymentCash: boolean;
  paymentCard: boolean;
}) {
  const router = useRouter();
  const { items, totalPrice, clearBag } = useBag();

  const availablePaymentMethods = useMemo<PaymentMethod[]>(() => {
    const list: PaymentMethod[] = [];
    if (paymentPix) list.push("pix");
    if (paymentCash) list.push("cash");
    if (paymentCard) list.push("card");
    return list;
  }, [paymentPix, paymentCash, paymentCard]);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [zip, setZip] = useState("");
  const [street, setStreet] = useState("");
  const [number, setNumber] = useState("");
  const [complement, setComplement] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [reference, setReference] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(availablePaymentMethods[0] ?? null);
  const [changeForInput, setChangeForInput] = useState("");
  const [observation, setObservation] = useState("");
  const [loading, setLoading] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  // Frete por distância (Fase 4.1.1): só entra em jogo quando a loja
  // configurou raio máximo e/ou método "por km" — no caso comum (taxa fixa
  // sem raio) nada aqui é chamado, o comportamento continua idêntico ao de
  // antes desta fase. O cálculo em si (geocoding) sempre acontece no
  // servidor (getDeliveryQuoteAction); o valor mostrado aqui é só preview —
  // create_order recalcula tudo de novo ao criar o pedido.
  const needsDeliveryQuote = deliveryRadiusKm !== null || deliveryFeeMethod === "per_km";
  const [quote, setQuote] = useState<{ distanceKm: number | null; fee: number } | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const quoteRequestId = useRef(0);

  const addressComplete = Boolean(street.trim() && number.trim() && neighborhood.trim() && city.trim());

  useEffect(() => {
    if (!needsDeliveryQuote) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuote(null);
      setQuoteError(null);
      return;
    }
    if (!addressComplete) {
      setQuote(null);
      setQuoteError(null);
      setQuoteLoading(false);
      return;
    }

    const requestId = ++quoteRequestId.current;
    setQuoteLoading(true);
    setQuoteError(null);

    const timeoutId = setTimeout(async () => {
      const result = await getDeliveryQuoteAction(slug, { zip, street, number, neighborhood, city, state });
      if (quoteRequestId.current !== requestId) return; // resposta de uma digitação anterior — ignorar
      setQuoteLoading(false);
      if (result.status === "error") {
        setQuote(null);
        setQuoteError(result.message);
        return;
      }
      setQuote({ distanceKm: result.distanceKm, fee: result.fee });
    }, 700);

    return () => clearTimeout(timeoutId);
  }, [needsDeliveryQuote, addressComplete, slug, zip, street, number, neighborhood, city, state]);

  useEffect(() => {
    // sessionStorage só existe no client — não dá pra usar isso num
    // useState(() => ...) porque o SSR não tem acesso a window (mesmo
    // motivo da hidratação da sacola em BagContext.tsx).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIdempotencyKey(readOrCreateIdempotencyKey(slug));
  }, [slug]);

  // Sacola vazia não deve chegar ao checkout — exceto durante o próprio
  // redirecionamento de sucesso (clearBag esvazia a sacola antes de navegar
  // para a confirmação, e não queremos que este efeito "sequestre" essa
  // navegação de volta para a sacola).
  useEffect(() => {
    if (items.length === 0 && !redirecting) {
      router.replace(`/loja/${slug}/sacola`);
    }
  }, [items.length, redirecting, router, slug]);

  const effectiveDeliveryFee = needsDeliveryQuote ? quote?.fee ?? null : (deliveryFee ?? 0);
  const total = totalPrice + (effectiveDeliveryFee ?? 0);
  const changeForValue = changeForInput.trim() ? parseMoneyInput(changeForInput) : null;

  const canSubmit =
    availablePaymentMethods.length > 0 &&
    paymentMethod !== null &&
    items.length > 0 &&
    !loading &&
    (!needsDeliveryQuote || (quote !== null && !quoteError && !quoteLoading));

  async function handleSubmit() {
    setErrorMessage(null);

    if (!paymentMethod || !idempotencyKey) return;

    const nameValidation = validateCustomerName(customerName);
    if (!nameValidation.ok) return setErrorMessage(nameValidation.error);

    const phoneValidation = validateCustomerPhone(customerPhone);
    if (!phoneValidation.ok) return setErrorMessage(phoneValidation.error);

    const addressValidation = validateDeliveryAddress({ street, number, neighborhood, city });
    if (!addressValidation.ok) return setErrorMessage(addressValidation.error);

    if (needsDeliveryQuote && (quoteError || !quote)) {
      return setErrorMessage(quoteError ?? "Aguarde o cálculo do frete para este endereço.");
    }

    const minimumOrderValidation = validateMinimumOrder(totalPrice, minimumOrderValue);
    if (!minimumOrderValidation.ok) return setErrorMessage(minimumOrderValidation.error);

    if (paymentMethod === "cash" && changeForInput.trim()) {
      if (changeForValue === null) return setErrorMessage("Informe um valor de troco válido.");
      const changeValidation = validateChangeFor(changeForValue, total);
      if (!changeValidation.ok) return setErrorMessage(changeValidation.error);
    }

    const observationValidation = validateCheckoutObservation(observation);
    if (!observationValidation.ok) return setErrorMessage(observationValidation.error);

    setLoading(true);
    const result = await submitOrderAction({
      slug,
      customerName,
      customerPhone,
      fulfillmentType: "delivery",
      delivery: { zip, street, number, complement, neighborhood, city, state, reference },
      paymentMethod,
      changeFor: paymentMethod === "cash" ? changeForValue : null,
      observation,
      items: buildOrderItemsPayload(items),
      idempotencyKey,
    });

    if (result.status === "error") {
      setErrorMessage(result.message);
      setLoading(false);
      return;
    }

    setRedirecting(true);
    try {
      window.sessionStorage.removeItem(idempotencyStorageKey(slug));
    } catch {
      // sessionStorage indisponível — sem impacto: a próxima chave só seria
      // reaproveitada dentro da mesma aba de qualquer forma.
    }
    clearBag();
    router.push(`/loja/${slug}/pedido/${result.publicId}`);
  }

  if (items.length === 0) return null;

  return (
    <div className="pb-32">
      <div className="sticky top-0 z-20 flex items-center gap-2 bg-surface-card/95 px-3.5 py-3 backdrop-blur-md">
        <button
          type="button"
          onClick={() => router.push(`/loja/${slug}/sacola`)}
          aria-label="Voltar para a sacola"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-graphite hover:bg-surface-subdued"
        >
          ←
        </button>
        <span className="text-sm font-bold text-graphite">Checkout</span>
      </div>

      <div className="space-y-5 px-3.5 py-4">
        {availablePaymentMethods.length === 0 && (
          <div className="rounded-xl border border-amber/20 bg-amber/10 px-3.5 py-2.5 text-xs font-medium text-amber">
            Esta loja ainda não concluiu a configuração de pagamento. Tente novamente mais tarde.
          </div>
        )}
        {minimumOrderValue !== null && totalPrice < minimumOrderValue && (
          <div className="rounded-xl border border-amber/20 bg-amber/10 px-3.5 py-2.5 text-xs font-medium text-amber">
            Pedido mínimo de {formatCurrencyBRL(minimumOrderValue)}. Adicione mais itens à sacola para continuar.
          </div>
        )}

        <section className="space-y-3">
          <h2 className="text-sm font-extrabold text-graphite">Seus dados</h2>
          <div>
            <label className="mb-1 block text-xs font-bold text-graphite" htmlFor="customerName">
              Nome
            </label>
            <input
              id="customerName"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Seu nome"
              className="w-full rounded-xl border border-border bg-surface-card px-3 py-2 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-graphite" htmlFor="customerPhone">
              WhatsApp/telefone
            </label>
            <input
              id="customerPhone"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="(11) 91234-5678"
              inputMode="tel"
              className="w-full rounded-xl border border-border bg-surface-card px-3 py-2 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
            />
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-extrabold text-graphite">Endereço de entrega</h2>
          <div className="grid grid-cols-2 gap-2">
            <input
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              placeholder="CEP (opcional)"
              className="col-span-2 rounded-xl border border-border bg-surface-card px-3 py-2 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
            />
            <input
              value={street}
              onChange={(e) => setStreet(e.target.value)}
              placeholder="Rua"
              className="col-span-2 rounded-xl border border-border bg-surface-card px-3 py-2 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
            />
            <input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="Número"
              className="rounded-xl border border-border bg-surface-card px-3 py-2 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
            />
            <input
              value={complement}
              onChange={(e) => setComplement(e.target.value)}
              placeholder="Complemento (opcional)"
              className="rounded-xl border border-border bg-surface-card px-3 py-2 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
            />
            <input
              value={neighborhood}
              onChange={(e) => setNeighborhood(e.target.value)}
              placeholder="Bairro"
              className="col-span-2 rounded-xl border border-border bg-surface-card px-3 py-2 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
            />
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Cidade"
              className="rounded-xl border border-border bg-surface-card px-3 py-2 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
            />
            <input
              value={state}
              onChange={(e) => setState(e.target.value)}
              placeholder="UF"
              maxLength={2}
              className="rounded-xl border border-border bg-surface-card px-3 py-2 text-sm uppercase text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
            />
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Referência (opcional)"
              className="col-span-2 rounded-xl border border-border bg-surface-card px-3 py-2 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
            />
          </div>

          {needsDeliveryQuote && addressComplete && (
            <div className="rounded-xl border border-border bg-surface-subdued/60 px-3.5 py-2.5 text-sm">
              {quoteLoading && <p className="text-text-muted">Calculando distância e frete...</p>}
              {!quoteLoading && quoteError && <p className="font-semibold text-red">{quoteError}</p>}
              {!quoteLoading && !quoteError && quote && (
                <div className="space-y-0.5">
                  {quote.distanceKm !== null && (
                    <p className="text-text-muted">
                      📍 Distância estimada: <span className="font-semibold text-graphite">{quote.distanceKm.toFixed(1)} km</span>
                    </p>
                  )}
                  <p className="text-text-muted">
                    🚚 Taxa de entrega: <span className="font-semibold text-graphite">{formatCurrencyBRL(quote.fee)}</span>
                  </p>
                </div>
              )}
            </div>
          )}
        </section>

        {availablePaymentMethods.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-extrabold text-graphite">Forma de pagamento</h2>
            <div className="flex flex-wrap gap-2">
              {availablePaymentMethods.map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => setPaymentMethod(method)}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-bold transition-colors ${
                    paymentMethod === method
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-graphite hover:bg-surface-subdued"
                  }`}
                >
                  {PAYMENT_METHOD_LABELS[method]}
                </button>
              ))}
            </div>
            {paymentMethod === "cash" && (
              <div>
                <label className="mb-1 block text-xs font-bold text-graphite" htmlFor="changeFor">
                  Troco para (opcional)
                </label>
                <input
                  id="changeFor"
                  value={changeForInput}
                  onChange={(e) => setChangeForInput(e.target.value)}
                  placeholder="Ex.: 50,00"
                  inputMode="decimal"
                  className="w-full rounded-xl border border-border bg-surface-card px-3 py-2 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
                />
              </div>
            )}
          </section>
        )}

        <section className="space-y-2">
          <label className="block text-sm font-extrabold text-graphite" htmlFor="checkoutObservation">
            Observação do pedido (opcional)
          </label>
          <textarea
            id="checkoutObservation"
            value={observation}
            onChange={(e) => setObservation(e.target.value)}
            rows={2}
            placeholder="Ex.: interfone quebrado, deixar na portaria..."
            className="w-full rounded-xl border border-border bg-surface-card px-3 py-2 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
          />
        </section>

        <section className="space-y-2 rounded-2xl border border-border bg-surface-subdued/60 p-3.5">
          <h2 className="text-sm font-extrabold text-graphite">Resumo</h2>
          <div className="space-y-1 text-xs">
            {items.map((item) => (
              <div key={item.key} className="flex justify-between gap-2 text-text-muted">
                <span className="truncate">
                  {item.quantity}x {item.name}
                </span>
                <span className="shrink-0 font-semibold text-graphite">{formatCurrencyBRL(item.subtotal)}</span>
              </div>
            ))}
          </div>
          <div className="space-y-1 border-t border-border pt-2 text-sm">
            <div className="flex justify-between text-text-muted">
              <span>Subtotal</span>
              <span className="font-semibold text-graphite">{formatCurrencyBRL(totalPrice)}</span>
            </div>
            <div className="flex justify-between text-text-muted">
              <span>Taxa de entrega</span>
              <span className="font-semibold text-graphite">
                {effectiveDeliveryFee !== null ? formatCurrencyBRL(effectiveDeliveryFee) : "—"}
              </span>
            </div>
            <div className="flex justify-between text-base font-extrabold text-graphite">
              <span>Total</span>
              <span>{formatCurrencyBRL(total)}</span>
            </div>
          </div>
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 flex justify-center border-t border-border bg-surface-card px-3.5 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
        <div className="w-full max-w-[420px] space-y-2">
          {errorMessage && <p className="text-center text-xs font-semibold text-red">{errorMessage}</p>}
          <button
            type="button"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="flex h-12 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-bold text-white shadow-[0_8px_20px_-4px_rgba(249,87,33,0.35)] transition-all hover:bg-[#ff5436] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Enviando pedido..." : `Finalizar pedido · ${formatCurrencyBRL(total)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

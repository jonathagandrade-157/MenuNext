"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/States";
import {
  calculateItemSubtotal,
  createBagItem,
  validateAllGroupsSelection,
  validateBagItemQuantity,
  type BagItem,
  type BagSelectedAddon,
} from "@/lib/bag";
import {
  PAYMENT_METHOD_LABELS,
  buildOrderItemsPayload,
  generateIdempotencyKey,
  validateChangeFor,
  type PaymentMethod,
} from "@/lib/checkout";
import { parseMoneyInput } from "@/lib/products";
import { formatCurrencyBRL, type PublicCategoryWithProducts, type PublicProductDetail } from "@/lib/store";
import {
  createCounterOrderAction,
  getCounterProductDetailAction,
  validateCounterCouponAction,
} from "@/lib/actions/counterOrders";
import { StoreAddonGroupSelector } from "@/components/loja/StoreAddonGroupSelector";

/**
 * Frente de Caixa / PDV real (decisão tomada com o usuário): venda de
 * balcão registrada por um membro autenticado do restaurante, usando a
 * mesma create_order (fulfillment_type='counter') e, a partir daí, o mesmo
 * fluxo de KDS/Kanban de qualquer outro pedido — nada aqui duplica lógica
 * de preço/validação, que já vem de src/lib/bag.ts e src/lib/checkout.ts
 * (mesmas funções puras usadas pelo checkout público).
 *
 * Carrinho é estado local, não persistido — se a página recarregar no meio
 * de uma venda, o carrinho reseta (limitação aceita para esta primeira
 * versão real, não é dado fabricado nem simulado, é só um estado efêmero
 * de UI).
 */
export function CaixaClient({
  categories,
  paymentPix,
  paymentCash,
  paymentCard,
}: {
  categories: PublicCategoryWithProducts[];
  paymentPix: boolean;
  paymentCash: boolean;
  paymentCard: boolean;
}) {
  const availablePaymentMethods = useMemo<PaymentMethod[]>(() => {
    const list: PaymentMethod[] = [];
    if (paymentPix) list.push("pix");
    if (paymentCash) list.push("cash");
    if (paymentCard) list.push("card");
    return list;
  }, [paymentPix, paymentCash, paymentCard]);

  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<BagItem[]>([]);

  // Modal de adicionar item (produto + adicionais + quantidade)
  const [pickedProduct, setPickedProduct] = useState<PublicProductDetail | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickingLoading, setPickingLoading] = useState(false);
  const [pickingError, setPickingError] = useState<string | null>(null);
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [itemQuantity, setItemQuantity] = useState(1);
  const [itemObservation, setItemObservation] = useState("");

  // Dados da venda
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(availablePaymentMethods[0] ?? null);
  const [changeForInput, setChangeForInput] = useState("");
  const [observation, setObservation] = useState("");

  const [couponInput, setCouponInput] = useState("");
  const [couponApplied, setCouponApplied] = useState<{ code: string; discountAmount: number } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponValidating, setCouponValidating] = useState(false);

  const [idempotencyKey, setIdempotencyKey] = useState(() => generateIdempotencyKey());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastOrderNumber, setLastOrderNumber] = useState<number | null>(null);

  const filteredCategories = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return categories;
    return categories
      .map((category) => ({ ...category, products: category.products.filter((p) => p.name.toLowerCase().includes(term)) }))
      .filter((category) => category.products.length > 0);
  }, [categories, search]);

  const subtotal = cart.reduce((sum, item) => sum + item.subtotal, 0);
  const discountAmount = couponApplied?.discountAmount ?? 0;
  const total = subtotal - discountAmount;
  const changeForValue = changeForInput.trim() ? parseMoneyInput(changeForInput) : null;
  const changeForValidation = validateChangeFor(paymentMethod === "cash" ? changeForValue : null, total);

  const canSubmit =
    cart.length > 0 && paymentMethod !== null && !submitting && (paymentMethod !== "cash" || changeForInput.trim() === "" || changeForValidation.ok);

  async function openProductPicker(productId: string) {
    setPickerOpen(true);
    setPickedProduct(null);
    setPickingError(null);
    setSelections({});
    setItemQuantity(1);
    setItemObservation("");
    setPickingLoading(true);
    const result = await getCounterProductDetailAction(productId);
    setPickingLoading(false);
    if (!result.ok) {
      setPickingError(result.error);
      return;
    }
    setPickedProduct(result.product);
  }

  function closeProductPicker() {
    setPickerOpen(false);
    setPickedProduct(null);
    setPickingError(null);
  }

  const selectedAddons = useMemo<BagSelectedAddon[]>(() => {
    if (!pickedProduct) return [];
    const result: BagSelectedAddon[] = [];
    for (const group of pickedProduct.addonGroups) {
      for (const addonId of selections[group.id] ?? []) {
        const addon = group.addons.find((a) => a.id === addonId);
        if (addon) result.push({ groupId: group.id, addonId: addon.id, name: addon.name, price: addon.price });
      }
    }
    return result;
  }, [pickedProduct, selections]);

  const groupsValidation = pickedProduct
    ? validateAllGroupsSelection(pickedProduct.addonGroups, selections)
    : ({ ok: true } as const);
  const quantityValidation = validateBagItemQuantity(itemQuantity);
  const itemSubtotal = pickedProduct ? calculateItemSubtotal(pickedProduct.price, selectedAddons, itemQuantity) : 0;

  function handleConfirmAddItem() {
    if (!pickedProduct) return;
    if (!groupsValidation.ok) {
      setPickingError(groupsValidation.error);
      return;
    }
    if (!quantityValidation.ok) {
      setPickingError(quantityValidation.error);
      return;
    }
    const item = createBagItem({
      productId: pickedProduct.id,
      name: pickedProduct.name,
      basePrice: pickedProduct.price,
      imageUrl: pickedProduct.images[0]?.url ?? null,
      quantity: itemQuantity,
      observation: itemObservation,
      selectedAddons,
    });
    setCart((prev) => [...prev, item]);
    closeProductPicker();
  }

  function handleRemoveCartItem(key: string) {
    setCart((prev) => prev.filter((item) => item.key !== key));
  }

  async function handleApplyCoupon() {
    const code = couponInput.trim();
    if (!code) return;
    setCouponError(null);
    setCouponValidating(true);
    const result = await validateCounterCouponAction(code, subtotal);
    setCouponValidating(false);
    if (result.status === "error") {
      setCouponApplied(null);
      setCouponError(result.message);
      return;
    }
    setCouponApplied({ code: result.code, discountAmount: result.discountAmount });
  }

  function handleRemoveCoupon() {
    setCouponApplied(null);
    setCouponInput("");
    setCouponError(null);
  }

  function resetSale() {
    setCart([]);
    setCustomerName("");
    setCustomerPhone("");
    setPaymentMethod(availablePaymentMethods[0] ?? null);
    setChangeForInput("");
    setObservation("");
    handleRemoveCoupon();
    setIdempotencyKey(generateIdempotencyKey());
    setSubmitError(null);
  }

  async function handleSubmit() {
    setSubmitError(null);
    if (!paymentMethod || cart.length === 0) return;

    if (paymentMethod === "cash" && changeForInput.trim() && !changeForValidation.ok) {
      setSubmitError(changeForValidation.error);
      return;
    }

    setSubmitting(true);
    const result = await createCounterOrderAction({
      customerName,
      customerPhone,
      paymentMethod,
      changeFor: paymentMethod === "cash" ? changeForValue : null,
      observation,
      items: buildOrderItemsPayload(cart),
      idempotencyKey,
      couponCode: couponApplied?.code ?? null,
    });
    setSubmitting(false);

    if (result.status === "error") {
      setSubmitError(result.message);
      return;
    }

    setLastOrderNumber(result.orderNumber);
    resetSale();
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar produto..."
          className="h-11 w-full rounded-xl border border-border bg-surface-card px-3.5 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
        />

        {filteredCategories.length === 0 ? (
          <p className="rounded-xl border border-border bg-surface-subdued/60 px-4 py-6 text-center text-sm text-text-muted">
            Nenhum produto encontrado.
          </p>
        ) : (
          filteredCategories.map((category) => (
            <div key={category.id}>
              <h2 className="mb-2 text-sm font-extrabold text-graphite">{category.name}</h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {category.products.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    disabled={!product.is_available}
                    onClick={() => openProductPicker(product.id)}
                    className="flex flex-col items-start gap-1 rounded-xl border border-border bg-surface-card p-3 text-left transition-colors hover:border-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="text-sm font-bold text-graphite">{product.name}</span>
                    <span className="text-xs font-semibold text-primary">{formatCurrencyBRL(product.price)}</span>
                    {!product.is_available && <span className="text-[11px] font-semibold text-red">Indisponível</span>}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="space-y-4 rounded-2xl border border-border bg-surface-card p-4">
        {lastOrderNumber !== null && (
          <div className="rounded-xl border border-emerald/30 bg-emerald/10 px-3.5 py-2.5 text-sm font-semibold text-emerald">
            Venda #{lastOrderNumber} registrada! Pode continuar com a próxima.
          </div>
        )}

        <div>
          <h2 className="text-sm font-extrabold text-graphite">Venda atual</h2>
          {cart.length === 0 ? (
            <p className="mt-2 text-sm text-text-muted">Toque num produto à esquerda para adicionar.</p>
          ) : (
            <div className="mt-2 space-y-2">
              {cart.map((item) => (
                <div key={item.key} className="flex items-start justify-between gap-2 border-b border-border pb-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-graphite">
                      {item.quantity}x {item.name}
                    </p>
                    {item.selectedAddons.length > 0 && (
                      <p className="truncate text-xs text-text-muted">{item.selectedAddons.map((a) => a.name).join(", ")}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-semibold text-graphite">{formatCurrencyBRL(item.subtotal)}</span>
                    <button type="button" onClick={() => handleRemoveCartItem(item.key)} className="text-xs font-semibold text-red hover:underline">
                      Remover
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {cart.length > 0 && (
          <>
            <div className="space-y-2">
              <input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Nome do cliente (opcional)"
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
              />
              <input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="Telefone (opcional)"
                inputMode="tel"
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
              />
            </div>

            {availablePaymentMethods.length > 0 && (
              <div className="space-y-2">
                <span className="block text-xs font-bold text-graphite">Pagamento</span>
                <div className="flex flex-wrap gap-2">
                  {availablePaymentMethods.map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setPaymentMethod(method)}
                      className={`rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
                        paymentMethod === method ? "border-primary bg-primary/10 text-primary" : "border-border text-graphite hover:bg-surface-subdued"
                      }`}
                    >
                      {PAYMENT_METHOD_LABELS[method]}
                    </button>
                  ))}
                </div>
                {paymentMethod === "cash" && (
                  <input
                    value={changeForInput}
                    onChange={(e) => setChangeForInput(e.target.value)}
                    placeholder="Troco para (opcional)"
                    inputMode="decimal"
                    className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
                  />
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <span className="block text-xs font-bold text-graphite">Cupom de desconto</span>
              {couponApplied ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald/30 bg-emerald/10 px-3 py-2">
                  <span className="text-xs font-bold text-graphite">
                    {couponApplied.code} (-{formatCurrencyBRL(couponApplied.discountAmount)})
                  </span>
                  <button type="button" onClick={handleRemoveCoupon} className="text-xs font-semibold text-red hover:underline">
                    Remover
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    value={couponInput}
                    onChange={(e) => {
                      setCouponInput(e.target.value.toUpperCase());
                      setCouponError(null);
                    }}
                    placeholder="Código"
                    className="h-10 flex-1 rounded-lg border border-border bg-surface px-3 text-sm uppercase text-graphite placeholder:text-slate-400 placeholder:normal-case focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
                  />
                  <button
                    type="button"
                    disabled={!couponInput.trim() || couponValidating}
                    onClick={handleApplyCoupon}
                    className="shrink-0 rounded-lg border border-border px-3 text-xs font-bold text-graphite hover:bg-surface-subdued disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {couponValidating ? "..." : "Aplicar"}
                  </button>
                </div>
              )}
              {couponError && <p className="text-xs font-semibold text-red">{couponError}</p>}
            </div>

            <textarea
              value={observation}
              onChange={(e) => setObservation(e.target.value)}
              rows={2}
              placeholder="Observação da venda (opcional)"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
            />

            <div className="space-y-1 border-t border-border pt-2 text-sm">
              <div className="flex justify-between text-text-muted">
                <span>Subtotal</span>
                <span className="font-semibold text-graphite">{formatCurrencyBRL(subtotal)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-emerald">
                  <span>Cupom</span>
                  <span className="font-semibold">-{formatCurrencyBRL(discountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-extrabold text-graphite">
                <span>Total</span>
                <span>{formatCurrencyBRL(total)}</span>
              </div>
            </div>

            {submitError && <ErrorState message={submitError} />}

            <Button onClick={handleSubmit} disabled={!canSubmit} loading={submitting} className="w-full">
              {submitting ? "Registrando..." : `Finalizar venda · ${formatCurrencyBRL(total)}`}
            </Button>
          </>
        )}
      </div>

      <Modal open={pickerOpen} onClose={closeProductPicker} title={pickedProduct?.name ?? "Adicionar item"}>
        {pickingLoading && <p className="text-sm text-text-muted">Carregando...</p>}
        {pickingError && !pickedProduct && <ErrorState message={pickingError} />}
        {pickedProduct && (
          <div className="space-y-4">
            {pickedProduct.description && <p className="text-sm text-text-muted">{pickedProduct.description}</p>}
            <p className="text-lg font-black text-graphite">{formatCurrencyBRL(pickedProduct.price)}</p>

            {pickedProduct.addonGroups.length > 0 && (
              <div className="space-y-4">
                {pickedProduct.addonGroups.map((group) => (
                  <StoreAddonGroupSelector
                    key={group.id}
                    group={group}
                    selectedIds={selections[group.id] ?? []}
                    onChange={(ids) => setSelections((prev) => ({ ...prev, [group.id]: ids }))}
                  />
                ))}
              </div>
            )}

            <input
              value={itemObservation}
              onChange={(e) => setItemObservation(e.target.value)}
              placeholder="Observação do item (opcional)"
              className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
            />

            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-graphite">Quantidade</span>
              <div className="flex items-center gap-3 rounded-xl border border-border p-1">
                <button
                  type="button"
                  disabled={itemQuantity <= 1}
                  onClick={() => setItemQuantity((q) => Math.max(1, q - 1))}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-graphite hover:bg-surface-subdued disabled:cursor-not-allowed disabled:opacity-40"
                >
                  −
                </button>
                <span className="w-6 text-center text-sm font-bold text-graphite">{itemQuantity}</span>
                <button
                  type="button"
                  onClick={() => setItemQuantity((q) => q + 1)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-graphite hover:bg-surface-subdued"
                >
                  +
                </button>
              </div>
            </div>

            {pickingError && <ErrorState message={pickingError} />}

            <Button onClick={handleConfirmAddItem} className="w-full">
              Adicionar · {formatCurrencyBRL(itemSubtotal)}
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}

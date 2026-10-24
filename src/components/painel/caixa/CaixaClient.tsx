"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Image as ImageIcon, Search } from "lucide-react";
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
import { changeToGiveBack } from "@/lib/cash";
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
  cashOpen,
}: {
  categories: PublicCategoryWithProducts[];
  paymentPix: boolean;
  paymentCash: boolean;
  paymentCard: boolean;
  /** Caixa aberto? Fechado bloqueia a venda aqui e na Server Action (createCounterOrderAction). */
  cashOpen: boolean;
}) {
  const availablePaymentMethods = useMemo<PaymentMethod[]>(() => {
    const list: PaymentMethod[] = [];
    if (paymentPix) list.push("pix");
    if (paymentCash) list.push("cash");
    if (paymentCard) list.push("card");
    return list;
  }, [paymentPix, paymentCash, paymentCard]);

  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
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
    return categories
      .filter((category) => !activeCategory || category.id === activeCategory)
      .map((category) => ({
        ...category,
        products: term ? category.products.filter((p) => p.name.toLowerCase().includes(term)) : category.products,
      }))
      .filter((category) => category.products.length > 0);
  }, [categories, search, activeCategory]);

  const subtotal = cart.reduce((sum, item) => sum + item.subtotal, 0);
  const discountAmount = couponApplied?.discountAmount ?? 0;
  const total = subtotal - discountAmount;
  const changeForValue = changeForInput.trim() ? parseMoneyInput(changeForInput) : null;
  const changeForValidation = validateChangeFor(paymentMethod === "cash" ? changeForValue : null, total);
  const changeDue = paymentMethod === "cash" && changeForValidation.ok ? changeToGiveBack(changeForValue, total) : null;

  const canSubmit =
    cashOpen &&
    cart.length > 0 &&
    paymentMethod !== null &&
    !submitting &&
    (paymentMethod !== "cash" || changeForInput.trim() === "" || changeForValidation.ok);

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
    if (!cashOpen) {
      setSubmitError("Abra o caixa antes de registrar vendas.");
      return;
    }
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

  // Atalhos de balcão: F2 foca a busca, F9 finaliza a venda.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "F9" && canSubmit) {
        e.preventDefault();
        void handleSubmit();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  return (
    // inert = nada aqui recebe clique, foco ou leitor de tela enquanto o caixa está fechado.
    <div
      inert={!cashOpen}
      aria-disabled={!cashOpen}
      className={`grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px] ${cashOpen ? "" : "select-none opacity-50"}`}
    >
      <div className="min-w-0 space-y-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar produto..."
            aria-label="Buscar produto"
            className="h-11 w-full rounded-xl border border-border bg-surface-card pl-10 pr-14 text-body-md text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
          />
          <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-border bg-surface-subdued px-1.5 py-0.5 text-[11px] font-semibold text-text-muted sm:block">
            F2
          </kbd>
        </div>

        {categories.length > 1 && (
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Categorias">
            {[{ id: null as string | null, name: "Todos" }, ...categories.map((c) => ({ id: c.id as string | null, name: c.name }))].map((chip) => {
              const active = activeCategory === chip.id;
              return (
                <button
                  key={chip.id ?? "all"}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveCategory(chip.id)}
                  className={`shrink-0 rounded-full border px-3.5 py-1.5 text-label-md font-bold transition-colors ${
                    active ? "border-primary bg-primary text-white" : "border-border bg-surface-card text-graphite hover:bg-surface-subdued"
                  }`}
                >
                  {chip.name}
                </button>
              );
            })}
          </div>
        )}

        {filteredCategories.length === 0 ? (
          <p className="rounded-xl border border-border bg-surface-subdued/60 px-4 py-6 text-center text-body-md text-text-muted">
            Nenhum produto encontrado.
          </p>
        ) : (
          filteredCategories.map((category) => (
            <div key={category.id}>
              <h2 className="mb-2 text-body-lg font-bold text-graphite">{category.name}</h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {category.products.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    disabled={!product.is_available}
                    onClick={() => openProductPicker(product.id)}
                    className="flex flex-col items-stretch gap-2 rounded-xl border border-border bg-surface-card p-2.5 text-left transition-colors hover:border-primary hover:bg-primary/5 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="flex h-20 items-center justify-center overflow-hidden rounded-lg bg-surface-subdued text-text-muted">
                      {product.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <ImageIcon className="h-6 w-6" aria-hidden />
                      )}
                    </span>
                    <span className="line-clamp-2 text-body-md font-bold text-graphite">{product.name}</span>
                    <span className="text-label-md text-primary">{formatCurrencyBRL(product.price)}</span>
                    {!product.is_available && <span className="text-[11px] font-semibold text-red">Indisponível</span>}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="space-y-4 self-start rounded-2xl border border-border bg-surface-card p-4 xl:sticky xl:top-4">
        {lastOrderNumber !== null && (
          <div className="rounded-xl border border-emerald/30 bg-emerald/10 px-3.5 py-2.5 text-label-lg text-emerald">
            Venda #{lastOrderNumber} registrada! Pode continuar com a próxima.
          </div>
        )}

        <div>
          <h2 className="text-body-lg font-bold text-graphite">Venda atual</h2>
          {cart.length === 0 ? (
            <p className="mt-2 text-body-md text-text-muted">Toque num produto à esquerda para adicionar.</p>
          ) : (
            <div className="mt-2 space-y-2">
              {cart.map((item) => (
                <div key={item.key} className="flex items-start justify-between gap-2 border-b border-border pb-2 text-body-md">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-graphite">
                      {item.quantity}x {item.name}
                    </p>
                    {item.selectedAddons.length > 0 && (
                      <p className="truncate text-body-sm text-text-muted">{item.selectedAddons.map((a) => a.name).join(", ")}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-semibold text-graphite">{formatCurrencyBRL(item.subtotal)}</span>
                    <button type="button" onClick={() => handleRemoveCartItem(item.key)} className="text-label-md text-red hover:underline">
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
                className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-body-md text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
              />
              <input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="Telefone (opcional)"
                inputMode="tel"
                className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-body-md text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
              />
            </div>

            {availablePaymentMethods.length > 0 && (
              <div className="space-y-2">
                <span className="block text-label-md font-bold text-graphite">Pagamento</span>
                <div className="flex flex-wrap gap-2">
                  {availablePaymentMethods.map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setPaymentMethod(method)}
                      className={`rounded-lg border px-3 py-2 text-label-md font-bold transition-colors ${
                        paymentMethod === method ? "border-primary bg-primary/10 text-primary" : "border-border text-graphite hover:bg-surface-subdued"
                      }`}
                    >
                      {PAYMENT_METHOD_LABELS[method]}
                    </button>
                  ))}
                </div>
                {paymentMethod === "cash" && (
                  <div className="space-y-2">
                    <input
                      value={changeForInput}
                      onChange={(e) => setChangeForInput(e.target.value)}
                      placeholder="Cliente pagou com (opcional)"
                      aria-label="Valor recebido em dinheiro"
                      inputMode="decimal"
                      className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-body-md text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { label: "Exato", value: total },
                        ...[20, 50, 100, 200].filter((v) => v > total).map((v) => ({ label: formatCurrencyBRL(v), value: v })),
                      ].map((quick) => (
                        <button
                          key={quick.label}
                          type="button"
                          onClick={() => setChangeForInput((Math.round(quick.value * 100) / 100).toFixed(2).replace(".", ","))}
                          className="rounded-lg border border-border px-2.5 py-1 text-label-md font-bold text-graphite hover:bg-surface-subdued"
                        >
                          {quick.label}
                        </button>
                      ))}
                    </div>
                    {changeDue !== null && changeForInput.trim() !== "" && (
                      <p className="rounded-lg bg-emerald/10 px-3 py-2 text-label-lg font-bold text-emerald">
                        Troco a devolver: {formatCurrencyBRL(changeDue)}
                      </p>
                    )}
                    {changeForInput.trim() !== "" && !changeForValidation.ok && (
                      <p className="text-label-md text-red">{changeForValidation.error}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <span className="block text-label-md font-bold text-graphite">Cupom de desconto</span>
              {couponApplied ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald/30 bg-emerald/10 px-3 py-2">
                  <span className="text-label-md font-bold text-graphite">
                    {couponApplied.code} (-{formatCurrencyBRL(couponApplied.discountAmount)})
                  </span>
                  <button type="button" onClick={handleRemoveCoupon} className="text-label-md text-red hover:underline">
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
                    className="h-10 flex-1 rounded-xl border border-border bg-surface px-3 text-body-md uppercase text-graphite placeholder:text-slate-400 placeholder:normal-case focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
                  />
                  <button
                    type="button"
                    disabled={!couponInput.trim() || couponValidating}
                    onClick={handleApplyCoupon}
                    className="shrink-0 rounded-lg border border-border px-3 text-label-md font-bold text-graphite hover:bg-surface-subdued disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {couponValidating ? "..." : "Aplicar"}
                  </button>
                </div>
              )}
              {couponError && <p className="text-label-md text-red">{couponError}</p>}
            </div>

            <textarea
              value={observation}
              onChange={(e) => setObservation(e.target.value)}
              rows={2}
              placeholder="Observação da venda (opcional)"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-body-md text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
            />

            <div className="space-y-1 border-t border-border pt-2 text-body-md">
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
              <div className="flex justify-between text-body-lg font-bold text-graphite">
                <span>Total</span>
                <span>{formatCurrencyBRL(total)}</span>
              </div>
            </div>

            {submitError && <ErrorState message={submitError} />}

            <Button onClick={handleSubmit} disabled={!canSubmit} loading={submitting} size="lg" className="w-full">
              {submitting ? "Registrando..." : `Finalizar venda · ${formatCurrencyBRL(total)}`}
              {!submitting && <kbd className="hidden rounded-md bg-white/20 px-1.5 py-0.5 text-[11px] font-semibold sm:inline">F9</kbd>}
            </Button>
          </>
        )}
      </div>

      <Modal open={pickerOpen} onClose={closeProductPicker} title={pickedProduct?.name ?? "Adicionar item"}>
        {pickingLoading && <p className="text-body-md text-text-muted">Carregando...</p>}
        {pickingError && !pickedProduct && <ErrorState message={pickingError} />}
        {pickedProduct && (
          <div className="space-y-4">
            {pickedProduct.description && <p className="text-body-md text-text-muted">{pickedProduct.description}</p>}
            <p className="text-headline-sm text-graphite">{formatCurrencyBRL(pickedProduct.price)}</p>

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
              className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-body-md text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
            />

            <div className="flex items-center justify-between">
              <span className="text-body-md font-bold text-graphite">Quantidade</span>
              <div className="flex items-center gap-3 rounded-xl border border-border p-1">
                <button
                  type="button"
                  disabled={itemQuantity <= 1}
                  onClick={() => setItemQuantity((q) => Math.max(1, q - 1))}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-graphite hover:bg-surface-subdued disabled:cursor-not-allowed disabled:opacity-40"
                >
                  −
                </button>
                <span className="w-6 text-center text-body-md font-bold text-graphite">{itemQuantity}</span>
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

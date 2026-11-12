"use client";

import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { createVariantAction, deleteVariantAction, toggleVariantAvailableAction, updateVariantAction } from "@/lib/actions/variants";
import { parseMoneyInput } from "@/lib/products";
import { formatCurrencyBRL } from "@/lib/store";
import { VARIANT_MAX_PER_PRODUCT, VARIANT_NAME_MAX, type Variant } from "@/lib/variants";

type ProductLite = { id: string; name: string; price: number };
const INPUT = "h-10 w-full rounded-xl border border-border bg-surface-card px-3 text-body-md text-graphite placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15";

export function VariantesClient({ products, variants }: { products: ProductLite[]; variants: Record<string, Variant[]> }) {
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const product = products.find((p) => p.id === productId) ?? null;
  const list = useMemo(() => variants[productId] ?? [], [variants, productId]);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "Não foi possível concluir.");
      after?.();
    });
  }

  if (products.length === 0) return <EmptyState title="Você ainda não possui produtos." description="Cadastre um produto antes de criar variantes." />;

  return (
    <div className="space-y-4">
      <Card className="border-amber/30 bg-amber/5 p-4 text-body-md text-graphite">
        Por enquanto as variantes ficam só no cadastro: <strong>ainda não aparecem na loja nem no pedido do cliente</strong>, que segue
        pelo preço do produto.
      </Card>

      <label className="block space-y-1">
        <span className="text-label-md text-graphite">Produto</span>
        <select value={productId} onChange={(e) => { setProductId(e.target.value); setEditing(null); setError(null); }} className={INPUT}>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name} — {formatCurrencyBRL(p.price)}</option>)}
        </select>
      </label>

      {error && <ErrorState message={error} />}

      <Card className="overflow-hidden p-0">
        {list.length === 0 ? (
          <p className="px-5 py-6 text-center text-body-md text-text-muted">{product?.name} ainda não tem variantes.</p>
        ) : (
          <ul className="divide-y divide-border">
            {list.map((v) => (
              <li key={v.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                {editing === v.id ? (
                  <div className="flex flex-1 flex-col gap-2 sm:flex-row">
                    <input value={editName} maxLength={VARIANT_NAME_MAX} onChange={(e) => setEditName(e.target.value)} aria-label="Nome" className={INPUT} />
                    <input value={editPrice} inputMode="decimal" onChange={(e) => setEditPrice(e.target.value)} aria-label="Preço" className={`${INPUT} sm:w-32`} />
                    <Button size="sm" disabled={pending} onClick={() => run(() => updateVariantAction(v.id, editName, parseMoneyInput(editPrice), v.isAvailable), () => setEditing(null))}>Salvar</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
                  </div>
                ) : (
                  <>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-graphite">{v.name}</p>
                      <p className="text-body-sm text-text-muted">{formatCurrencyBRL(v.price)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" aria-pressed={v.isAvailable} disabled={pending} onClick={() => run(() => toggleVariantAvailableAction(v.id, !v.isAvailable))}>
                        <Badge tone={v.isAvailable ? "success" : "neutral"}>{v.isAvailable ? "Disponível" : "Indisponível"}</Badge>
                      </button>
                      <Button size="sm" variant="secondary" onClick={() => { setEditing(v.id); setEditName(v.name); setEditPrice(String(v.price).replace(".", ",")); setError(null); }}>Editar</Button>
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => deleteVariantAction(v.id))}>Excluir</Button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="text-headline-sm text-graphite">Nova variante{product ? ` de ${product.name}` : ""}</h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={name} maxLength={VARIANT_NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Grande" aria-label="Nome da variante" className={INPUT} />
          <input value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} placeholder="Preço (R$)" aria-label="Preço da variante" className={`${INPUT} sm:w-40`} />
          <Button disabled={pending || list.length >= VARIANT_MAX_PER_PRODUCT} loading={pending} onClick={() => run(() => createVariantAction(productId, name, parseMoneyInput(price), true), () => { setName(""); setPrice(""); })}>Adicionar</Button>
        </div>
        {list.length >= VARIANT_MAX_PER_PRODUCT && <p className="text-body-sm text-text-muted">Limite de {VARIANT_MAX_PER_PRODUCT} variantes por produto.</p>}
      </Card>
    </div>
  );
}
